from django.contrib.auth.models import User
from ninja.security import HttpBearer
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .models import LawyerProfile


class JWTAuth(HttpBearer):
    def authenticate(self, request, token):
        try:
            access = AccessToken(token)
            user_id = access["user_id"]
        except TokenError:
            return None

        try:
            user = User.objects.select_related("lawyer_profile__firm").get(id=user_id)
        except User.DoesNotExist:
            return None

        if not user.is_active:
            return None

        profile = getattr(user, "lawyer_profile", None)

        if profile is not None and not profile.firm.is_active:
            return None

        return profile


class SuperAdminAuth(HttpBearer):
    """
    Platform-level auth, entirely separate from JWTAuth/LawyerProfile - a
    super admin isn't scoped to any firm. `request.auth` resolves to the
    Django User itself (not a LawyerProfile).
    """

    def authenticate(self, request, token):
        try:
            access = AccessToken(token)
            user_id = access["user_id"]
        except TokenError:
            return None

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return None

        if not user.is_active or not user.is_superuser:
            return None

        return user
