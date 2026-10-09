# Rendered contrast evidence

These are actual Chromium captures of the production build (and the real-component gallery using its CSS). Accounts/content are disposable **fake fixtures**, not production users. The complete audit and limitations are in [CONTRAST-AUDIT.md](../CONTRAST-AUDIT.md).

Desktop: 1440×1000. Narrow wheel: 320×844. Portrait intro: 390×844. Images are unmodified PNG captures. All listed main screens were visually reviewed in both themes; the additional intro/disabled/dialog examples preserve representative states.

| Screen | Dark | Light |
| --- | --- | --- |
| home | [Dark](dark-home.png) | [Light](light-home.png) |
| login | [Dark](dark-login.png) | [Light](light-login.png) |
| explore | [Dark](dark-explore.png) | [Light](light-explore.png) |
| communities | [Dark](dark-communities.png) | [Light](light-communities.png) |
| chat | [Dark](dark-chat.png) | [Light](light-chat.png) |
| market | [Dark](dark-market.png) | [Light](light-market.png) |
| notifications | [Dark](dark-notifications.png) | [Light](light-notifications.png) |
| appearance | [Dark](dark-appearance.png) | [Light](light-appearance.png) |
| profile | [Dark](dark-profile.png) | [Light](light-profile.png) |
| moderator | [Dark](dark-moderator.png) | [Light](light-moderator.png) |
| admin | [Dark](dark-admin.png) | [Light](light-admin.png) |
| onboarding | [Dark](dark-onboarding.png) | [Light](light-onboarding.png) |
| account-status | [Dark](dark-account-status.png) | [Light](light-account-status.png) |
| Chat bubbles / metadata / composer | [Dark](dark-chat-thread.png) | [Light](light-chat-thread.png) |
| Buttons / fields / disabled styles | [Dark](dark-components.png) | [Light](light-components.png) |
| Dialog / warning / destructive action | [Dark](dark-dialog.png) | [Light](light-dialog.png) |
| 320px wheel | [Dark](dark-wheel-320px.png) | [Light](light-wheel-320px.png) |
| Real intro, desktop | [Dark](dark-intro-desktop.png) | [Light](light-intro-desktop.png) |
| Real intro, portrait | [Dark](dark-intro-portrait.png) | [Light](light-intro-portrait.png) |

Appearance snapshots may display the resolved Light/Dark choice after System follows the context's device preference; the narrow-wheel examples are explicit selections. Intro branding deliberately remains white/deep-blue in either theme.

[Results JSON](results.json) records successful full and follow-up runs, painted focus counts and layout assertions. The full run's initial passive-toast sample gap was covered by the subsequent component run; the final harness now rejects empty foreground measurements. Raw per-glyph JSON, cookies and browser/DB artifacts stay in excluded cache directories rather than Git.
