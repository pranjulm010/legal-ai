from .models import AuditLog


def log_audit_event(firm, actor, action: str, details: str = "") -> None:
    AuditLog.objects.create(firm=firm, actor=actor, action=action, details=details)
