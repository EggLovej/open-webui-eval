"""
Switchable features of this fork, so each can be evaluated on its own and in combination.

The client sends its switches in form_data['features'] (see src/lib/utils/features.ts,
which defines the same defaults). A missing switch means the default, so API clients
that send none get the default behaviour.
"""

FEATURE_DEFAULTS = {
    # One citation id per chunk with its lines labelled as segments, and sources shown next to the chat
    'enriched_references': True,
}


def feature_enabled(features: dict | None, name: str) -> bool:
    value = (features or {}).get(name)
    return FEATURE_DEFAULTS[name] if not isinstance(value, bool) else value
