from __future__ import annotations

import tempfile
import unittest

from mc_pvp_env.action_abi import SwordPvPActionV1
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.mocks import MockBotController
from mc_pvp_env.restricted_dataset import RestrictedDatasetWriter, load_restricted_dataset
from mc_pvp_env.restricted_rollout import collect_restricted_rollout


class RestrictedRolloutTests(unittest.TestCase):
    def test_collect_restricted_rollout_writes_apply_restricted_action_acks(self) -> None:
        bot = MockBotController()
        client = bot.client()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                writer = RestrictedDatasetWriter(
                    tmp,
                    config=EnvConfig(),
                    backend="herobot",
                    minecraft_version="1.21.11",
                    server_runtime="fabric-1.21.11",
                    visual_profile_id="none",
                    mouse_profile_id="herobot_relative_v1",
                )

                collect_restricted_rollout(
                    bot_client=client,
                    writer=writer,
                    agent_id="ROBO-A0",
                    episode_id="restricted-ep",
                    arena_id="arena_0",
                    actions=[
                        SwordPvPActionV1(sequence_id=1, observation_tick=20, mouse_dx=3),
                        SwordPvPActionV1(sequence_id=2, observation_tick=21, attack_pulse=True),
                    ],
                )

                dataset = load_restricted_dataset(tmp)
                rows = dataset.load_episode(dataset.episode_files[0])
                self.assertEqual([row.action_requested.sequence_id for row in rows], [1, 2])
                self.assertEqual([row.action_executed.source_sequence_id for row in rows], [1, 2])
                self.assertEqual([action["type"] for action in bot.actions], ["apply_restricted_action", "apply_restricted_action"])
        finally:
            client.close()
            bot.close()


if __name__ == "__main__":
    unittest.main()
