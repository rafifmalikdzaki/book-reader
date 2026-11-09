"""Mistral + PageIndex categorization for the local library.

Categories are virtual and keyed by the same SHA-256 content identity used by
the reindexer. No file is moved. The organizer only sends a document's title,
section headings, and a short first-page excerpt to Mistral after the UI
confirms that request.
"""
