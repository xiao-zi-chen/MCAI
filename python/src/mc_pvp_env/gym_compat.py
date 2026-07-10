from __future__ import annotations

try:
    import gymnasium as gym
    from gymnasium import spaces
except Exception:  # pragma: no cover - exercised only without gymnasium installed.
    gym = None

    class Env:
        metadata = {}

        def reset(self, *, seed=None, options=None):
            return None, {}

    class Box:
        def __init__(self, low, high, shape, dtype):
            self.low = low
            self.high = high
            self.shape = tuple(shape)
            self.dtype = dtype

    class MultiDiscrete:
        def __init__(self, nvec):
            self.nvec = nvec
            self.shape = tuple(nvec.shape)

    class Discrete:
        def __init__(self, n):
            self.n = n
            self.shape = ()

    class _Spaces:
        Box = Box
        Discrete = Discrete
        MultiDiscrete = MultiDiscrete

    class _Gym:
        Env = Env

    gym = _Gym()
    spaces = _Spaces()
