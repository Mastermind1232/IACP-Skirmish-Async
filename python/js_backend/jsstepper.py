"""JSStepper — Python client for the Node-side training server.

Spawns one Node subprocess (src/headless/training/server.js) per stepper
instance. Communicates via line-delimited JSON over stdin/stdout. The
subprocess holds no session state; every step passes the full game
object so the same subprocess can be reused across many concurrent
games if desired.

Usage:
    stepper = JSStepper()
    game = stepper.new_game(p1_army=[{'dcName': 'Rebel Trooper (Regular)'}],
                             p2_army=[{'dcName': 'Stormtrooper (Regular)'}])
    actions = stepper.legal_actions(game, player_num=1)
    game, events = stepper.step(game, actions[0]['customId'], user_id='player1')
    reward = stepper.terminal(game)
    stepper.close()

Threading: one JSStepper per thread. Node subprocess is not safe for
concurrent requests — each `submit()` is synchronous (write + read one
response).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_JS = REPO_ROOT / 'src' / 'headless' / 'training' / 'server.js'


class JSStepperError(RuntimeError):
    pass


class JSStepper:
    """Thin RPC client over a Node subprocess. Each method sends a
    command and blocks on the matching-id response."""

    def __init__(
        self,
        node_path: str = 'node',
        server_script: Optional[Path] = None,
        cwd: Optional[Path] = None,
    ) -> None:
        script = server_script or SERVER_JS
        if not Path(script).exists():
            raise JSStepperError(f'server script not found: {script}')
        self._proc = subprocess.Popen(
            [node_path, str(script)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=str(cwd or REPO_ROOT),
            text=True, bufsize=1,
        )
        self._lock = threading.Lock()
        self._req_id = 0
        # Read the initial "ready" message.
        ready = self._read_line()
        if not ready or not ready.get('ok') or not ready.get('ready'):
            stderr_dump = self._drain_stderr()
            raise JSStepperError(
                f'server did not become ready: {ready}\nstderr:\n{stderr_dump}'
            )

    # ------------------------------------------------------------------
    # Low-level transport
    # ------------------------------------------------------------------

    def _drain_stderr(self, max_chars: int = 4000) -> str:
        try:
            # Non-blocking read if process is alive. If dead, stderr is full.
            if self._proc.poll() is None:
                return ''
            out = self._proc.stderr.read() or ''
            return out[:max_chars]
        except Exception:
            return ''

    def _read_line(self) -> Optional[Dict[str, Any]]:
        line = self._proc.stdout.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            return None
        return json.loads(line)

    def _submit(self, cmd: str, **payload: Any) -> Dict[str, Any]:
        if self._proc.poll() is not None:
            raise JSStepperError(
                f'server already exited (code={self._proc.returncode}); '
                f'stderr: {self._drain_stderr()}'
            )
        with self._lock:
            self._req_id += 1
            req_id = self._req_id
            msg = {'id': req_id, 'cmd': cmd, **payload}
            line = json.dumps(msg) + '\n'
            self._proc.stdin.write(line)
            self._proc.stdin.flush()
            reply = self._read_line()
            if reply is None:
                raise JSStepperError(
                    f'server closed connection; stderr: {self._drain_stderr()}'
                )
            if reply.get('id') != req_id:
                raise JSStepperError(
                    f'id mismatch: expected {req_id}, got {reply.get("id")}'
                )
            if not reply.get('ok'):
                raise JSStepperError(reply.get('error') or 'unknown error')
            return reply

    # ------------------------------------------------------------------
    # High-level API
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        return bool(self._submit('ping').get('pong'))

    def new_game(
        self,
        p1_army: List[Any],
        p2_army: List[Any],
        p1_cc_deck: Optional[List[str]] = None,
        p2_cc_deck: Optional[List[str]] = None,
        map_id: str = 'mos-eisley-outskirts',
        p1_id: str = 'player1',
        p2_id: str = 'player2',
    ) -> Dict[str, Any]:
        reply = self._submit(
            'new_game',
            map_id=map_id, p1_army=p1_army, p2_army=p2_army,
            p1_cc_deck=p1_cc_deck or [], p2_cc_deck=p2_cc_deck or [],
            p1_id=p1_id, p2_id=p2_id,
        )
        return reply['game']

    def legal_actions(self, game: Dict[str, Any], player_num: int) -> List[Dict[str, Any]]:
        reply = self._submit('legal_actions', game=game, player_num=player_num)
        return reply.get('actions') or []

    def step(
        self,
        game: Dict[str, Any],
        custom_id: str,
        user_id: str,
        action_opts: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Dict[str, Any], List[Any], Optional[str]]:
        """Apply one action headlessly. Returns (new_game, events, error_or_None)."""
        reply = self._submit(
            'step',
            game=game,
            customId=custom_id,
            user_id=user_id,
            action_opts=action_opts or {},
        )
        return reply['game'], reply.get('events') or [], reply.get('error')

    def terminal(self, game: Dict[str, Any]) -> Dict[str, Any]:
        return self._submit('terminal', game=game)

    def close(self) -> None:
        if self._proc.poll() is None:
            try:
                self._submit('exit')
            except Exception:
                pass
            try:
                self._proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=2.0)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
