from django.apps import apps
from django.core.management.base import BaseCommand

TARGET_APPS = {"accounts", "cases", "api", "drafts"}


class Command(BaseCommand):
    help = (
        "Generates a Mermaid erDiagram of the current Django schema "
        "(accounts, cases, api, drafts apps) for documentation/demo purposes. "
        "Paste the output into https://mermaid.live or a Mermaid-aware markdown viewer."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--output", type=str, help="Write the diagram to this file instead of stdout."
        )

    def handle(self, *args, **options):
        models = [
            model
            for model in apps.get_models()
            if model._meta.app_label in TARGET_APPS
        ]

        lines = ["erDiagram"]
        relationship_lines = []
        seen_m2m_pairs = set()
        referenced_models = {}

        for model in models:
            referenced_models[model] = model

            for field in model._meta.get_fields():
                if getattr(field, "auto_created", False) and not field.concrete:
                    continue

                if field.many_to_one or field.one_to_one:
                    if not field.concrete:
                        continue
                    related_model = field.related_model
                    referenced_models[related_model] = related_model
                    connector = "||--||" if field.one_to_one else "||--o{"
                    left = _entity_name(related_model)
                    right = _entity_name(model)
                    relationship_lines.append(f'    {left} {connector} {right} : "{field.name}"')

                elif field.many_to_many and field.concrete:
                    related_model = field.related_model
                    referenced_models[related_model] = related_model
                    pair = tuple(sorted([_entity_name(model), _entity_name(related_model)]))

                    if pair in seen_m2m_pairs:
                        continue

                    seen_m2m_pairs.add(pair)
                    left = _entity_name(model)
                    right = _entity_name(related_model)
                    relationship_lines.append(f'    {left} }}o--o{{ {right} : "{field.name}"')

        for model in referenced_models.values():
            lines.append(f"    {_entity_name(model)} {{")

            for field in model._meta.fields:
                field_type = field.get_internal_type()
                lines.append(f"        {field_type} {field.name}")

            lines.append("    }")

        lines.extend(relationship_lines)

        diagram = "\n".join(lines)
        output_path = options.get("output")

        if output_path:
            with open(output_path, "w", encoding="utf-8") as file:
                file.write(diagram + "\n")
            self.stdout.write(self.style.SUCCESS(f"ER diagram written to {output_path}"))
        else:
            self.stdout.write(diagram)


def _entity_name(model) -> str:
    return model.__name__.upper()
