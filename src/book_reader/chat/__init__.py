"""Agentic chat over the library: LangGraph tool loop with a provider fallback chain.

Public names are re-exported here so ``from book_reader.chat import ChatService`` keeps working.
The heavy langchain/langgraph imports live in the submodules, so import this package lazily.
"""

from __future__ import annotations

from ..chat_providers import DEFAULT_PRIORITY as DEFAULT_PRIORITY
from ..chat_providers import PROVIDER_DEFAULTS as PROVIDER_DEFAULTS
from ..chat_providers import PROVIDER_KEY_ENVS as PROVIDER_KEY_ENVS
from ..chat_providers import resolve_providers as resolve_providers
from ..chat_types import AskCallbacks as AskCallbacks
from ..chat_types import AskOptions as AskOptions
from ..chat_types import ChatError as ChatError
from ..chat_types import ChatMessage as ChatMessage
from ..chat_types import ChatUnavailable as ChatUnavailable
from ..chat_types import ProviderConfig as ProviderConfig
from .limits import MAX_SOURCE_TEXT as MAX_SOURCE_TEXT
from .limits import MAX_STEPS as MAX_STEPS
from .limits import MAX_TOOL_ROUNDS as MAX_TOOL_ROUNDS
from .prompts import openui_format as openui_format
from .prompts import openui_instructions as openui_instructions
from .service import ChatService as ChatService
from .sources import _with_context_source as _with_context_source
from .sources import collect_sources as collect_sources
