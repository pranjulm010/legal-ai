from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


def build_invite_link(user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.FRONTEND_URL}/set-password/{uid}/{token}/"


def send_lawyer_invite_email(user, firm_name: str) -> str:
    """
    Sends the invite email and returns the invite link (the caller falls
    back to showing this link to the admin if sending fails/isn't
    configured, so a new lawyer is never locked out because of email
    delivery issues).
    """
    link = build_invite_link(user)

    send_mail(
        subject=f"You've been added to {firm_name} on Legal AI",
        message=(
            f"Hi {user.first_name or user.username},\n\n"
            f"You've been added as a lawyer at {firm_name} on Legal AI.\n\n"
            f"Set your password to activate your account:\n{link}\n\n"
            f"This link expires in a few days. If you weren't expecting this, "
            f"you can ignore this email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )

    return link
