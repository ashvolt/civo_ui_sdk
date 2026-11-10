# Quickstart: Stress, Soak and Security Benchmark

*The commands as they will work once implemented; see [tasks.md](./tasks.md).*

```bash
pnpm install && pnpm build
pnpm bench:smoke                       # what a pull request runs: ~10 min
pnpm bench                             # everything, both profiles, every contender: ~2 h
pnpm bench -- --workload table-cells --renderer ours-element --profile phone
pnpm bench -- --soak --minutes 30
pnpm bench:attacks                     # injection, protocol, tricks
pnpm bench:redteam                     # needs Ollama with qwen2.5:3b and llama3.2:3b
pnpm bench:dashboard                   # builds bench/dashboard/dist from bench/results/
```

Reproduce a published figure: every number on the dashboard shows the command,
seed and machine it came from.

Before trusting results from your own machine, run `pnpm bench:selftest`. It
checks the harness itself:
- a deliberately slowed renderer breaks early;
- a deliberately wrong one breaks on correctness;
- a deliberately unsafe one is classified "executed".
