"""Admin-only request handlers — thin port of src/handlers/requests.js.

Both request buttons rename a thread (Discord API). The Python port
handles the admin-permission validation; the actual thread rename
belongs to the bot layer.

  request_resolve_{threadId}  — mark a request thread as [IMPLEMENTED]
  request_reject_{threadId}   — mark a request thread as [REJECTED]
"""
from __future__ import annotations

from typing import Any, Dict

from python.discord_bot.handlers import register


def _cid(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _admin_gated(interaction: Any, ctx: Dict[str, Any], prefix: str,
                   new_prefix: str) -> Dict[str, Any]:
    """Shared body: parse threadId, require admin, report the intended
    rename prefix for the bot layer to execute."""
    cid = _cid(interaction)
    if not cid.startswith(prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    thread_id = cid[len(prefix):]
    if not thread_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    if not ctx.get('is_admin'):
        return {'ok': False, 'reason': 'admin_required'}
    return {
        'ok': True, 'threadId': thread_id, 'renameTo': new_prefix,
    }


def _handle_request_resolve(interaction: Any,
                              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """request_resolve_{threadId} — admin-only; intent to mark the
    thread as [IMPLEMENTED]. Bot layer performs the Discord rename.
    Mirrors src/handlers/requests.js:14-40.
    """
    return _admin_gated(interaction, ctx, 'request_resolve_',
                          '[IMPLEMENTED] ')


def _handle_request_reject(interaction: Any,
                             ctx: Dict[str, Any]) -> Dict[str, Any]:
    """request_reject_{threadId} — admin-only; intent to mark the
    thread as [REJECTED]. Mirrors src/handlers/requests.js:42-68.
    """
    return _admin_gated(interaction, ctx, 'request_reject_',
                          '[REJECTED] ')


register('request_resolve_', _handle_request_resolve, 'core')
register('request_reject_', _handle_request_reject, 'core')
