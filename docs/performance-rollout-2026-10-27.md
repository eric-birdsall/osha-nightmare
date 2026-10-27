# Warehouse-wide stock rollout: preliminary performance

This rollout increases loose cartons from 503 to 862 compared with the Rack-A-only preview. There are 30 empty, 44 light, 51 normal and 23 near-full loose-stock locations. Five unused upper pallet bays are empty; required backstock and all strapped crates remain.

One eight-case browser pass: 1280 × 720, DPR 1, shadows enabled, fixed representative views, production Game.step/frame/render, HUD omitted. Normal cases move the forklift gently; stress cases forcibly tilt racks A/B/C. Warmup 1 second plus 5 seconds sampling per case. All runs reported a visible document. This is not a hardware qualification or an FPS guarantee.

| Profile | View | Scenario | Median frame ms | P95 frame ms | P95 CPU work ms | Median draw calls |
|---|---|---|---:|---:|---:|---:|
| Before rollout | single | Normal warehouse | 8.3 | 9 | 5.6 | 2845 |
| After rollout | single | Normal warehouse | 8.3 | 9.9 | 6.2 | 3145 |
| Before rollout | single | Three-rack collapse | 8.3 | 9.9 | 6.3 | 2818 |
| After rollout | single | Three-rack collapse | 8.3 | 10.2 | 8.4 | 3125 |
| Before rollout | coop | Normal warehouse | 8.4 | 16.7 | 11.8 | 4229 |
| After rollout | coop | Normal warehouse | 8.3 | 16.6 | 10.6 | 4745 |
| Before rollout | coop | Three-rack collapse | 8.3 | 10.4 | 10.3 | 4202 |
| After rollout | coop | Three-rack collapse | 8.3 | 15 | 10.7 | 4722 |

Median frame intervals remained 8.3–8.4 ms in this short test. Draw submissions increased about 11–12%, and single-player collapse CPU work P95 increased from 6.3 to 8.4 ms. Split collapse frame P95 increased from 10.4 to 15.0 ms. Normal split CPU measurements were lower after rollout, a reminder that short runs contain scheduling/noise effects. Treat this as evidence of increased workload with retained headroom on this device, not proof of unchanged performance everywhere.

Reproduce with Vite at `/tools/warehouse-performance.html?rollout=1`. `?rollout=1&reverse=1` reverses stock order. Raw results are in the adjacent JSON file. The before fixture preserves the Rack-A-only stock and uses the preceding single-row layout on other racks. No saved gameplay progress or stored settings are changed.
