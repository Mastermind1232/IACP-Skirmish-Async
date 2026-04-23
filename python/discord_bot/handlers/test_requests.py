"""Tests for request admin handlers."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _User:
    def __init__(self, uid): self.id = uid


class _Interaction:
    def __init__(self, custom_id, user_id='alice'):
        self.custom_id = custom_id
        self.user = _User(user_id)


def _fresh_registry():
    from python.discord_bot import handlers
    from python.discord_bot.handlers import requests as rq
    handlers.reset_for_tests()
    handlers.register('request_resolve_', rq._handle_request_resolve, 'core')
    handlers.register('request_reject_', rq._handle_request_reject, 'core')


def test_resolve_admin_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('request_resolve_T1')
    result = handler(_Interaction('request_resolve_T1'), {'is_admin': True})
    assert result['ok'] is True
    assert result['threadId'] == 'T1'
    assert result['renameTo'] == '[IMPLEMENTED] '


def test_resolve_non_admin_rejected():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('request_resolve_T1')
    result = handler(_Interaction('request_resolve_T1'), {})
    assert result['ok'] is False
    assert result['reason'] == 'admin_required'


def test_reject_admin_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('request_reject_T1')
    result = handler(_Interaction('request_reject_T1'), {'is_admin': True})
    assert result['ok'] is True
    assert result['renameTo'] == '[REJECTED] '


def test_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('request_resolve_')
    result = handler(_Interaction('request_resolve_'), {'is_admin': True})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def main():
    cases = [
        ('resolve_admin_ok', test_resolve_admin_ok),
        ('resolve_non_admin', test_resolve_non_admin_rejected),
        ('reject_admin_ok', test_reject_admin_ok),
        ('malformed', test_malformed),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
