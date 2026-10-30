# liquid-taffy

Source: https://github.com/arknow91/liquid-taffy/tree/4bcf4005f857c371bf53d60b2cee14abcecedf6a

Copyright (c) 2026 arknow91. MIT licensed. The full upstream license is shipped
as `ails-frontend/public/licenses/liquid-taffy/LICENSE.txt` with frontend assets.

`core.ts` retains the calibrated rim thresholds from `liquid/goo.ts`, the house
spring samples from `liquid/springs.ts`, and the continuous-corner path from
`liquid/squircle.ts`. AILS uses native SVG attributes and requestAnimationFrame
to drive these primitives. The settings-tab surface owns its detachment
choreography, static/liquid handoff, theme tokens and motion-reduction handling.

The workspace selection surface also adapts `PillTabs/PillTabs.tsx`: one shared
background, concurrent position/width travel, bounded stretch, interrupted
animation cleanup and resize alignment. Its 300ms native frame controller
keeps AILS' connected tab silhouette and does not require GSAP or sound.
