"""Inline keyboards. Callback data is compact `verb:id[:arg]` and validated in the webhook handler."""

from __future__ import annotations


def button(text: str, data: str) -> dict:
    return {"text": text, "callback_data": data[:64]}


def task_actions_keyboard(task_id: int, *, done: bool = False) -> dict:
    if done:
        return {"inline_keyboard": [[button("↩ Reopen", f"reopen:{task_id}")]]}
    return {
        "inline_keyboard": [
            [button("✓ Done", f"done:{task_id}"), button("⏱ Start timer", f"timer:{task_id}")],
            [button("+1h", f"snooze:{task_id}:60"), button("Tomorrow", f"snooze:{task_id}:1440")],
        ]
    }


def task_list_keyboard(tasks) -> dict | None:
    rows = [[button(f"✓ {t.title[:40]}", f"done:{t.pk}")] for t in list(tasks)[:8]]
    return {"inline_keyboard": rows} if rows else None


def timer_keyboard(running: bool) -> dict:
    if running:
        return {"inline_keyboard": [[button("■ Stop timer", "timer_stop")]]}
    return {
        "inline_keyboard": [
            [button("▶ Business", "timer_start:business"), button("▶ Personal", "timer_start:personal")]
        ]
    }


def confirm_keyboard(action_id: int) -> dict:
    return {
        "inline_keyboard": [
            [button("✓ Confirm", f"ai_confirm:{action_id}"), button("✕ Cancel", f"ai_cancel:{action_id}")]
        ]
    }
