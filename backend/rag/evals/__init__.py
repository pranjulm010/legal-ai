"""
Answer-quality eval harness for the legal-AI RAG pipeline.

Unlike rag/tests.py (which mocks every LLM/retrieval call and only checks
*routing* decisions), this package runs the REAL pipeline end to end over
the bundled sample documents and scores the answers it produces:

  - retrieval recall@k  - did retrieval surface the chunk that holds the answer
  - answer correctness  - does the answer state the expected fact correctly
  - groundedness        - is every claim supported by the retrieved context
  - scope correctness   - are out-of-scope / not-in-document questions handled
                          without fabricating a document answer

It is the measurable baseline every later retrieval/generation change is
graded against. Run with: python manage.py run_evals
"""
