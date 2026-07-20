from rest_framework_simplejwt.tokens import AccessToken

from .context import reset_current_workspace_id, set_current_workspace_id


class AIProviderContextMiddleware:
    """
    Resolves the requesting lawyer's workspace (firm) from the same JWT
    bearer token accounts.auth.JWTAuth already validates, and stashes it
    in a request-scoped contextvar (ai_provider/context.py) for the
    duration of the request.

    This is purely additive plumbing for one purpose: letting
    rag/groq_client.py's get_groq_client() resolve "which workspace's AI
    credentials apply" without changing the signature of any function in
    rag/*.py. It duplicates JWTAuth's token decode rather than depending
    on it, since Django Ninja's auth classes run inside view dispatch,
    after standard middleware - by design, this never enforces
    authentication or rejects a request (that stays JWTAuth's job); it
    only ever *reads* identity that's already about to be validated
    properly downstream. Fails silently on any error (malformed/missing
    token, logged-out user, etc.) so this middleware can never be the
    reason a request that would otherwise succeed fails - the resolver's
    default (no workspace resolved = platform-managed) is always safe.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        reset_token = None
        try:
            reset_token = self._resolve_workspace(request)
        except Exception:
            # Never let identity-resolution plumbing break a real request -
            # TokenError, User.DoesNotExist, a malformed header, etc. all
            # just mean "no workspace resolved," which the resolver already
            # treats as platform-managed (today's exact default behavior).
            reset_token = None

        try:
            response = self.get_response(request)
        finally:
            if reset_token is not None:
                reset_current_workspace_id(reset_token)

        return response

    @staticmethod
    def _resolve_workspace(request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith("Bearer "):
            return None

        from django.contrib.auth.models import User

        raw_token = auth_header[len("Bearer "):].strip()
        access = AccessToken(raw_token)
        user_id = access["user_id"]
        user = User.objects.select_related("lawyer_profile").get(id=user_id)
        profile = getattr(user, "lawyer_profile", None)
        if profile is None or not user.is_active:
            return None
        return set_current_workspace_id(profile.firm_id)
