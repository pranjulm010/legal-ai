from typing import List
from django.conf import settings
from sentence_transformers import SentenceTransformer


_embedding_model = None


def get_embedding_model():
    global _embedding_model

    if _embedding_model is None:
        _embedding_model = SentenceTransformer(settings.EMBEDDING_MODEL)

    return _embedding_model


def embed_text(text: str) -> List[float]:
    model = get_embedding_model()
    embedding = model.encode(text)
    return embedding.tolist()


def embed_texts(texts: List[str]) -> List[List[float]]:
    model = get_embedding_model()
    embeddings = model.encode(texts)
    return [embedding.tolist() for embedding in embeddings]