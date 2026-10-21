"""Export the released PPO actor's numeric core, not a BedWars observation adapter."""
import json
from pathlib import Path
import sys
import numpy as np
import torch
from stable_baselines3 import PPO

ROOT = Path(__file__).resolve().parents[1]
torch.set_num_threads(1)
model = PPO.load(str(ROOT / "checkpoints/champion_robo/ppo_final.zip"), device="cpu")
modules = [*model.policy.mlp_extractor.policy_net, model.policy.action_net]
layers = []
for layer in modules:
    if isinstance(layer, torch.nn.Linear):
        layers.append({"type": "linear", "weight": layer.weight.detach().numpy().tolist(), "bias": layer.bias.detach().numpy().tolist()})
    elif isinstance(layer, torch.nn.Tanh):
        layers.append({"type": "tanh"})
    elif isinstance(layer, torch.nn.ReLU):
        layers.append({"type": "relu"})
    else:
        raise TypeError(f"Unsupported layer: {layer}")

target = ROOT / "submission-kit/model-demo"
target.mkdir(parents=True, exist_ok=True)
source = "// Numeric PPO actor demo ONLY. Requires a legal observation adapter and BedWars retraining.\n"
source += "const POLICY_LAYERS = " + json.dumps(layers, separators=(",", ":")) + ";\n"
source += """
function policyLogits(features) {
  if (!Array.isArray(features) || features.length !== POLICY_LAYERS[0].weight[0].length || !features.every(Number.isFinite)) throw new Error('Invalid features');
  let x = features;
  for (const layer of POLICY_LAYERS) {
    if (layer.type === 'linear') {
      const next = new Array(layer.bias.length);
      for (let row = 0; row < next.length; row++) {
        let sum = layer.bias[row];
        for (let col = 0; col < x.length; col++) sum += layer.weight[row][col] * x[col];
        next[row] = sum;
      }
      x = next;
    } else if (layer.type === 'tanh') x = x.map(Math.tanh);
    else if (layer.type === 'relu') x = x.map(v => Math.max(0, v));
    else throw new Error('Unknown layer');
  }
  return x;
}
function inferFeatures(features) {
  const logits = policyLogits(features);
  let best = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
  return best;
}
"""
(target / "policy-core.js").write_text(source, encoding="utf-8")
rng = np.random.default_rng(123)
inputs = rng.normal(0, 0.5, size=(32, model.observation_space.shape[0])).astype(np.float32)
with torch.inference_mode():
    outputs = torch.nn.Sequential(*modules)(torch.from_numpy(inputs)).numpy()
fixtures = {"parameters": sum(p.numel() for module in modules for p in module.parameters()), "features": inputs.tolist(), "logits": outputs.tolist()}
(target / "fixtures.json").write_text(json.dumps(fixtures), encoding="utf-8")
print(f"Exported {fixtures['parameters']} actor parameters; source {len(source.encode('utf-8'))} bytes.")
print("This proves a portable numeric core, not Minecraft or AGX compatibility.")
