# Mobile capability matrix

| Capability                              | iOS consumer                 | Android consumer               | Managed enterprise                                          |
| --------------------------------------- | ---------------------------- | ------------------------------ | ----------------------------------------------------------- |
| Open universal/app/deep link            | Supported                    | Supported                      | Supported                                                   |
| App Intent / Shortcut                   | Declared integrations only   | N/A                            | Declared integrations                                       |
| Android intent                          | N/A                          | Declared intents               | Extended allowlist                                          |
| Contact selection                       | Foreground permission        | Foreground permission          | Policy-managed                                              |
| Calendar create/update                  | EventKit + permission        | Calendar provider + permission | Policy-managed                                              |
| SMS/email                               | Compose UI or provider API   | Compose UI or provider API     | Provider/MDM policy                                         |
| Camera/document scan/location           | Foreground consent           | Foreground consent             | Policy-managed                                              |
| Home/Matter                             | Entitlement/device dependent | Provider/device dependent      | Organization-managed                                        |
| Arbitrary silent app control            | Unsupported                  | Unsupported                    | Unsupported unless a specific reviewed managed API exists   |
| General autonomous AccessibilityService | N/A                          | Prohibited in consumer flavor  | Separate managed flavor only if policy/legal review permits |

The backend cannot make an offline phone act. Commands expire safely and remain pending or route through a direct provider API.
