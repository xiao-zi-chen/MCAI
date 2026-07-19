import unittest

from mc_pvp_env.action_abi import ActionExecutionStatus, SwordPvPActionV1
from mc_pvp_env.mocks import MockBotController
from mc_pvp_env.protocol import decode_jsonl, encode_jsonl
from mc_pvp_env.restricted_client import apply_restricted_action


class ProtocolTests(unittest.TestCase):
    def test_encode_decode_jsonl_roundtrip(self):
        message = {"v": 1, "id": "x-1", "type": "hello"}
        self.assertEqual(decode_jsonl(encode_jsonl(message)), message)

    def test_decode_rejects_bad_version(self):
        with self.assertRaises(ValueError):
            decode_jsonl(b'{"v":2,"id":"x","type":"hello"}\n')

    def test_plugin_control_messages_decode(self):
        examples = [
            {"v": 1, "id": "p-2", "type": "ping"},
            {"v": 1, "id": "p-3", "type": "status"},
            {"v": 1, "id": "p-4", "type": "register_players", "arena_id": "arena_0", "players": ["ROBO-A0", "SCRIPT-A0"]},
            {"v": 1, "id": "p-6", "type": "reset", "episode_id": "ep-0001", "seed": 123, "arena_id": "arena_0"},
            {"v": 1, "id": "p-7", "type": "start_episode", "episode_id": "ep-0001", "arena_id": "arena_0"},
            {"v": 1, "id": "p-8", "type": "observe", "arena_id": "arena_0"},
            {"v": 1, "id": "p-9", "type": "wait_tick", "arena_id": "arena_0", "after_tick": 20},
            {"v": 1, "id": "p-10", "type": "reward_snapshot", "arena_id": "arena_0"},
            {"v": 1, "id": "p-11", "type": "done", "arena_id": "arena_0"},
            {"v": 1, "id": "p-12", "type": "cleanup"},
            {"v": 1, "id": "b-6", "type": "apply_action", "agent_id": "ROBO-A0", "repeat_ticks": 2, "action": [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 2, 0]},
            {"v": 1, "id": "b-7", "type": "apply_restricted_action", "agent_id": "ROBO-A0", "action": {"abi_version": "SwordPvPActionV1", "sequence_id": 1}},
        ]
        for message in examples:
            with self.subTest(message=message):
                self.assertEqual(decode_jsonl(encode_jsonl(message)), message)

    def test_apply_restricted_action_decodes_ack(self):
        bot = MockBotController()
        client = bot.client()
        try:
            result = apply_restricted_action(
                bot_client=client,
                agent_id="ROBO-A0",
                action=SwordPvPActionV1(sequence_id=5, move_forward=1, mouse_dx=3),
                request_id="b-test",
            )

            self.assertEqual(bot.actions[-1]["type"], "apply_restricted_action")
            self.assertEqual(bot.actions[-1]["action"]["abi_version"], "SwordPvPActionV1")
            self.assertEqual(result.requested.sequence_id, 5)
            self.assertEqual(result.executed.source_sequence_id, 5)
            self.assertEqual(result.status, ActionExecutionStatus.EXECUTED)
            self.assertEqual(result.status_reasons, ())
        finally:
            client.close()
            bot.close()


if __name__ == "__main__":
    unittest.main()
