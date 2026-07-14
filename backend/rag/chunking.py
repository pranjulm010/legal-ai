import re
from typing import List, Dict, Optional

# Matches the page/slide markers document_processor.py embeds directly in
# extracted text (e.g. "--- Page 3 ---", "--- OCR Page 3 ---",
# "--- Slide 2 ---") - used to tag each chunk with the page it came from
# for citation purposes, without needing a separate page-aware extraction
# pipeline.
_PAGE_MARKER_RE = re.compile(r"---\s*(?:OCR\s+)?(?:Page|Slide)\s+(\d+)\s*---")

# Common legal/general abbreviations that end with a period but do not end
# a sentence - prevents "Mr. Sharma...", "Sec. 302...", "State v. ..." from
# being sliced apart at the abbreviation's period.
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "sr", "jr", "prof", "vs", "v", "no", "nos",
    "sec", "secs", "art", "arts", "ord", "regn", "govt", "co", "ltd",
    "corp", "inc", "etc", "viz", "cl", "para", "paras", "rs", "u.p",
    "i.e", "e.g", "a.i.r", "s.c", "h.c", "hon'ble", "sh", "smt",
}

# A sentence boundary is a '.', '!' or '?' followed by whitespace and then
# what looks like the start of a new sentence (capital letter, digit, quote).
_SENTENCE_END_RE = re.compile(r'([.!?])(\s+)(?=[A-Z0-9"\'‘“])')


def _is_false_boundary(preceding_text: str) -> bool:
    words = preceding_text.split()

    if not words:
        return False

    last_word = words[-1].strip(".,;:()\"'‘’“”").lower()

    if not last_word:
        return False

    # Known abbreviation (e.g. "Mr.", "Sec.", "v.")
    if last_word in _ABBREVIATIONS:
        return True

    # A single letter before the period is almost always an initial
    # ("A. K. Sen") rather than a real sentence end.
    if len(last_word) == 1 and last_word.isalpha():
        return True

    return False


def _split_into_sentences(text: str) -> List[str]:
    """
    Lightweight, dependency-free sentence splitter tuned for legal text.
    Not a full NLP tokenizer, but avoids the common false-splits that
    matter most for legal documents (titles, section refs, citations).
    """

    sentences = []
    start = 0

    for match in _SENTENCE_END_RE.finditer(text):
        boundary_pos = match.start(1)
        preceding = text[start:boundary_pos]

        if _is_false_boundary(preceding):
            continue

        split_pos = match.end()
        sentence = text[start:split_pos].strip()

        if sentence:
            sentences.append(sentence)

        start = split_pos

    remainder = text[start:].strip()

    if remainder:
        sentences.append(remainder)

    return sentences


def _hard_split(sentence: str, chunk_size: int) -> List[str]:
    """
    Fallback for a single "sentence" longer than chunk_size on its own -
    e.g. punctuation-sparse OCR text with no real sentence boundaries.
    Falls back to fixed-size character slicing so no chunk is ever
    unbounded, matching the old chunker's size guarantee for this case.
    """

    return [
        sentence[i:i + chunk_size]
        for i in range(0, len(sentence), chunk_size)
    ]


def chunk_text(
    text: str,
    chunk_size: int = 900,
    overlap: int = 150
) -> List[Dict]:
    """
    Group sentences into chunks up to ~chunk_size characters, never
    splitting a sentence across two chunks. Each new chunk starts with
    the trailing ~overlap characters of sentences from the previous
    chunk, so retrieval doesn't lose context at a chunk boundary.
    """

    if not text or not text.strip():
        return []

    raw_sentences = _split_into_sentences(text.strip())

    if not raw_sentences:
        return []

    sentences: List[str] = []

    for sentence in raw_sentences:
        if len(sentence) > chunk_size:
            sentences.extend(_hard_split(sentence, chunk_size))
        else:
            sentences.append(sentence)

    chunks: List[Dict] = []
    chunk_id = 1
    current_sentences: List[str] = []
    current_len = 0
    current_page: Optional[int] = None
    chunk_start_page: Optional[int] = None

    def flush_chunk():
        nonlocal chunk_id

        chunk_body = " ".join(current_sentences).strip()

        if chunk_body:
            chunks.append({
                "chunk_id": chunk_id,
                "text": chunk_body,
                "page_number": chunk_start_page,
            })
            chunk_id += 1

    for sentence in sentences:
        sentence_len = len(sentence) + 1
        markers = _PAGE_MARKER_RE.findall(sentence)
        if markers:
            current_page = int(markers[-1])

        if not current_sentences:
            chunk_start_page = current_page

        if current_sentences and current_len + sentence_len > chunk_size:
            flush_chunk()

            overlap_sentences: List[str] = []
            overlap_len = 0

            for previous in reversed(current_sentences):
                if overlap_len >= overlap:
                    break
                overlap_sentences.insert(0, previous)
                overlap_len += len(previous) + 1

            current_sentences = overlap_sentences
            current_len = overlap_len
            chunk_start_page = current_page

        current_sentences.append(sentence)
        current_len += sentence_len

    flush_chunk()

    return chunks
