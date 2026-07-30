from datetime import datetime
from typing import List, Optional

from django.db.models import Q
from django.shortcuts import get_object_or_404
from ninja import Router, Schema

from accounts.auth import JWTAuth
from accounts.permissions import require_permission

from .models import Form

form_router = Router(auth=JWTAuth())


class ErrorSchema(Schema):
    error: str


class FormInSchema(Schema):
    title: str
    code: str = ""
    category: str = ""
    jurisdiction: str = ""
    description: str = ""
    required_fields: List[str] = []
    submission_url: str = ""


class FormUpdateSchema(Schema):
    title: Optional[str] = None
    code: Optional[str] = None
    category: Optional[str] = None
    jurisdiction: Optional[str] = None
    description: Optional[str] = None
    required_fields: Optional[List[str]] = None
    submission_url: Optional[str] = None


class FormOutSchema(Schema):
    id: int
    title: str
    code: str
    category: str
    jurisdiction: str
    description: str
    required_fields: List[str]
    submission_url: str
    created_at: datetime
    updated_at: datetime


@form_router.get("/", response=List[FormOutSchema])
def list_forms(request, q: Optional[str] = None):
    forms = Form.objects.filter(firm=request.auth.firm)
    if q:
        forms = forms.filter(
            Q(title__icontains=q) | Q(code__icontains=q) | Q(category__icontains=q)
        )
    return forms


@form_router.post("/", response={200: FormOutSchema, 403: ErrorSchema})
def create_form(request, payload: FormInSchema):
    denied = require_permission(request, "manage_forms")
    if denied:
        return denied

    form = Form.objects.create(
        firm=request.auth.firm,
        created_by=request.auth,
        **payload.dict(),
    )
    return 200, form


@form_router.get("/{form_id}/", response={200: FormOutSchema, 404: ErrorSchema})
def get_form(request, form_id: int):
    return 200, get_object_or_404(Form, id=form_id, firm=request.auth.firm)


@form_router.patch(
    "/{form_id}/", response={200: FormOutSchema, 403: ErrorSchema, 404: ErrorSchema}
)
def update_form(request, form_id: int, payload: FormUpdateSchema):
    denied = require_permission(request, "manage_forms")
    if denied:
        return denied

    form = get_object_or_404(Form, id=form_id, firm=request.auth.firm)
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(form, field, value)
    form.save()
    return 200, form


@form_router.delete(
    "/{form_id}/", response={200: dict, 403: ErrorSchema, 404: ErrorSchema}
)
def delete_form(request, form_id: int):
    denied = require_permission(request, "manage_forms")
    if denied:
        return denied

    form = get_object_or_404(Form, id=form_id, firm=request.auth.firm)
    form.delete()
    return 200, {"ok": True}
