import unittest

from mc_pvp_env.eval_ppo import _wait_for_players


class EvalPpoTests(unittest.TestCase):
    def test_wait_for_players_polls_until_names_are_present(self):
        client = SnapshotClient(
            [
                {"tick": 1, "players": []},
                {"tick": 2, "players": [{"name": "ROBO_A0"}, {"name": "SCRIPT_A0"}]},
            ]
        )

        snapshot = _wait_for_players(
            client,
            arena_id="arena_0",
            names=["ROBO_A0", "SCRIPT_A0"],
            attempts=3,
        )

        self.assertEqual(snapshot["tick"], 2)
        self.assertEqual(len(client.requests), 2)

    def test_wait_for_players_raises_with_last_snapshot_when_missing(self):
        client = SnapshotClient([{"tick": 1, "players": [{"name": "ROBO_A0"}]}])

        with self.assertRaisesRegex(RuntimeError, "missing players"):
            _wait_for_players(
                client,
                arena_id="arena_0",
                names=["ROBO_A0", "SCRIPT_A0"],
                attempts=1,
            )


class SnapshotClient:
    def __init__(self, snapshots):
        self.snapshots = list(snapshots)
        self.requests = []

    def request(self, payload):
        self.requests.append(payload)
        if self.snapshots:
            return self.snapshots.pop(0)
        return {"tick": 999, "players": []}


if __name__ == "__main__":
    unittest.main()
