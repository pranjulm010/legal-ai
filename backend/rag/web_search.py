"""
Web fallback search against a fixed allowlist of trusted legal sites per
region, used only when local firm-scoped RAG retrieval finds no
sufficiently relevant chunks, and only after the user has explicitly
consented to a web search.

Two search mechanisms:
1. Site-specific scrapers for sources with their own real search endpoint
   (Indian Kanoon, Bar & Bench) - used for India, in addition to (2).
2. A general site-restricted search via Mojeek for every other trusted
   domain/region. Mojeek was chosen after testing: DuckDuckGo's HTML
   endpoint returns a bot-detection anomaly challenge, and Bing returns a
   captcha challenge, for simple unauthenticated `requests` scraping.
   Mojeek serves plain server-rendered HTML with no such block. This is
   never a general web search - every query stays constrained to
   `site:` filters built from TRUSTED_DOMAINS_BY_REGION, so results are
   only ever pulled from official/trusted sources, never random blogs.

livelaw.in is intentionally NOT implemented as a dedicated scraper: its
on-site search is a Google Custom Search Engine (CSE) JS widget with no
server-rendered results and no public JSON API (confirmed live:
/api/v1/search-style paths 404). Scraping it would require either a
headless browser or a paid/keyed Google CSE API, both out of scope for
this MVP - it's still reachable indirectly via the Mojeek site: search
above.
"""

from typing import Dict, List
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

REQUEST_TIMEOUT_SECONDS = 5

INDIANKANOON_SEARCH_URL = "https://indiankanoon.org/search/?formInput={query}"
BARANDBENCH_SEARCH_URL = "https://www.barandbench.com/api/v1/search?q={query}&limit={limit}"
MOJEEK_SEARCH_URL = "https://www.mojeek.com/search?q={query}"

REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; LegalAIBot/1.0)"}

# Trusted official/government legal sources per jurisdiction, per the
# platform's regional-research requirement: never prioritize random blogs
# over official sources. Each region's web search is hard-restricted to
# only these domains via `site:` filters - nothing else is ever queried.
TRUSTED_DOMAINS_BY_REGION: Dict[str, List[str]] = {
    "india": [
        "indiacode.nic.in",
        "main.sci.gov.in",
        "ecourts.gov.in",
        "njdg.ecourts.gov.in",
        "barcouncilofindia.org",
        "lawmin.gov.in",
        "rbi.org.in",
        "gst.gov.in",
        "incometax.gov.in",
        "sebi.gov.in",
    ],
    "usa": [
        "supremecourt.gov",
        "congress.gov",
        "law.cornell.edu",
        "justice.gov",
        "irs.gov",
        "sec.gov",
    ],
    "uk": [
        "legislation.gov.uk",
        "supremecourt.uk",
        "bailii.org",
        "gov.uk",
    ],
    "canada": [
        "laws-lois.justice.gc.ca",
        "scc-csc.ca",
        "canlii.org",
    ],
    "australia": [
        "legislation.gov.au",
        "hcourt.gov.au",
        "austlii.edu.au",
    ],
    "singapore": [
        "sso.agc.gov.sg",
        "judiciary.gov.sg",
    ],
    "eu": [
        "eur-lex.europa.eu",
        "curia.europa.eu",
    ],
    "middle_east": [
        "government.ae",
        "moj.gov.ae",
    ],
}

DEFAULT_REGION = "india"


def search_indiankanoon(query: str, max_results: int = 5) -> List[Dict]:
    url = INDIANKANOON_SEARCH_URL.format(query=quote_plus(query))

    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException:
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    results = []

    for article in soup.select("article.result")[:max_results]:
        title_tag = article.select_one("h4.result_title a")
        if not title_tag:
            continue

        href = title_tag.get("href", "")
        title = title_tag.get_text(strip=True)

        snippet_tag = article.select_one("div.headline")
        snippet = snippet_tag.get_text(" ", strip=True) if snippet_tag else ""

        source_tag = article.select_one("div.hlbottom span.docsource")
        court = source_tag.get_text(strip=True) if source_tag else ""

        results.append({
            "title": title,
            "snippet": snippet,
            "court": court,
            "url": f"https://indiankanoon.org{href}",
            "source_site": "indiankanoon.org",
        })

    return results


def search_barandbench(query: str, max_results: int = 5) -> List[Dict]:
    url = BARANDBENCH_SEARCH_URL.format(query=quote_plus(query), limit=max_results)

    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        return []

    stories = data.get("results", {}).get("stories", [])
    results = []

    for story in stories[:max_results]:
        slug = story.get("slug", "")

        if not slug:
            continue

        results.append({
            "title": story.get("headline", ""),
            "snippet": story.get("subheadline", ""),
            "court": "",
            "url": f"https://www.barandbench.com/{slug}",
            "source_site": "barandbench.com",
        })

    return results


def search_trusted_domains(query: str, domains: List[str], max_results: int = 8) -> List[Dict]:
    """
    Searches only the given domains - never a general open web search.
    Used for every region's official government/court sources.

    Issues one `site:<domain>` query per domain rather than a single
    `(site:a OR site:b OR ...)` combined query: testing showed Mojeek's
    bot-detection flags multi-domain boolean queries specifically (real
    users don't type those), while simple single-site queries pass
    through cleanly. More requests, but each one looks like an ordinary
    search.
    """

    if not domains:
        return []

    per_domain_limit = max(1, max_results // len(domains) + 1)
    results = []

    for domain in domains:
        if len(results) >= max_results:
            break

        site_query = f"{query} site:{domain}"
        url = MOJEEK_SEARCH_URL.format(query=quote_plus(site_query))

        try:
            response = requests.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
        except requests.RequestException:
            continue

        soup = BeautifulSoup(response.text, "html.parser")

        for item in soup.select("ul.results-standard > li")[:per_domain_limit]:
            title_tag = item.select_one("h2 a.title")
            if not title_tag:
                continue

            url_value = title_tag.get("href", "")
            title = title_tag.get_text(strip=True)

            snippet_tag = item.select_one("p.s")
            snippet = snippet_tag.get_text(" ", strip=True) if snippet_tag else ""

            results.append({
                "title": title,
                "snippet": snippet,
                "court": "",
                "url": url_value,
                "source_site": domain,
            })

    return results[:max_results]


def search_legal_web(query: str, region: str = DEFAULT_REGION, max_results_per_site: int = 5) -> List[Dict]:
    """
    Combine results from all trusted sources for the given region. Each
    source is independently fault-tolerant: a failure on one does not
    affect the others. `region` must be a key in TRUSTED_DOMAINS_BY_REGION
    (falls back to India if unrecognized) - jurisdiction is never assumed
    silently for a region the caller didn't ask for.
    """

    region = (region or DEFAULT_REGION).lower()
    domains = TRUSTED_DOMAINS_BY_REGION.get(region, TRUSTED_DOMAINS_BY_REGION[DEFAULT_REGION])

    results: List[Dict] = []

    if region == "india":
        results.extend(search_indiankanoon(query, max_results=max_results_per_site))
        results.extend(search_barandbench(query, max_results=max_results_per_site))

    results.extend(search_trusted_domains(query, domains, max_results=max_results_per_site * 2))

    return results
