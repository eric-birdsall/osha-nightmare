# Rack A partial-stock preview and performance check

Rack A now has 4 empty, 4 light, 7 normal and 3 near-full locations. Its loose cartons drop from 252 to 125 (50.4% fewer). In the shipping-order-3 benchmark the warehouse has 503 loose cartons instead of 630; secured pallet contents are additional visual cartons inside combined bodies. Other racks are unchanged. Required shipping SKUs remain stocked; all five combined shifts still complete under the physics tests.

The test uses the production simulation/scene/render methods at 1280 × 720, DPR 1, shadows enabled, in the in-app browser on this computer. Views are fixed toward the warehouse/Rack A; the forklift moves gently in normal cases. The stress case forcibly tilts A/B/C together after warmup. CCTV is disabled in this test context, and the HUD is omitted. Each case has 1 second warmup plus 5 seconds sampling. Two trials reverse full/partial order. All cases reported a visible document. This is a short diagnostic, not a minimum-hardware qualification or an FPS guarantee.

| Scenario | Full draw calls | Partial draw calls | Reduction |
|---|---:|---:|---:|
| Single normal | 3,077 | 2,845–2,846 | 7.5% |
| Single collapse | 3,045 | 2,818 | 7.5% |
| Split normal | 4,609 | 4,229 | 8.2% |
| Split collapse | 4,572–4,574 | 4,202 | 8.1% |

Median frame intervals were mostly 8.3–8.4 ms in both layouts; the first full split-screen normal case was 9.3 ms. P95 intervals ranged 8.7–25.1 ms for full and 8.9–16.9 ms for partial across these runs. The first trial's partial single-normal P95 was worse than full (16.7 vs 8.7 ms), so there is no uniform measured frame-rate gain. The reversed trial was steadier: normal single CPU-work P95 was 5.4/5.2 ms full/partial, single collapse 7.2/6.3 ms, split normal 12.8/12.2 ms and split collapse 12.8/12.1 ms. CPU work includes render submission but does not measure GPU execution time.

Conclusion: partial stock reliably reduces loose bodies and draw submissions; these short tests show more headroom rather than a clear median-FPS jump. Keep the varied stock for readability and receiving space. Before increasing stock throughout the warehouse, test a longer gameplay session and lower-end hardware. Thousands of draw calls remain a good future target for batching/instancing independent of box quantity.

Reproduce: run Vite, open `/tools/warehouse-performance.html`, click Run comparison. Add `?reverse=1` to reverse stock order. Raw measurements are in `performance-2026-10-27.json`.
