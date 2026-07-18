package signal

bundle_version := "signal-default-v1"

decision := {"outcome": "DENY", "reason": "Secret data cannot leave the credential broker.", "limits": {}} if {
  "secret" in input.dataClasses
} else := {"outcome": "DENY", "reason": "Emergency stop denies new privileged leases.", "limits": {}} if {
  input.materialPayload.emergencyStop == true
} else := {"outcome": "REQUIRE_MULTI_PARTY_APPROVAL", "reason": "Privileged or irreversible actions require elevated approval.", "limits": {}} if {
  input.capability.risk == "R4"
} else := {"outcome": "REQUIRE_MULTI_PARTY_APPROVAL", "reason": "Privileged or irreversible actions require elevated approval.", "limits": {}} if {
  input.capability.sideEffect == "irreversible"
} else := {"outcome": "REQUIRE_APPROVAL", "reason": "Generated capabilities require explicit approval and canary evidence.", "limits": {"tenant_canary": true}} if {
  startswith(input.capability.name, "generated.")
} else := {"outcome": "REQUIRE_APPROVAL", "reason": "Browser final submission requires a digest-bound approval.", "limits": {"final_submit": true}} if {
  input.capability.name == "browser.final_submit"
} else := {"outcome": "DENY", "reason": "The configured financial ceiling was exceeded.", "limits": {"max_amount_minor": 100000}} if {
  input.amount != null
  input.amount.amountMinor > 100000
} else := {"outcome": "REQUIRE_APPROVAL", "reason": "Financial or sensitive actions require recent explicit approval.", "limits": {"max_amount_minor": 100000}} if {
  input.capability.risk == "R3"
} else := {"outcome": "REQUIRE_APPROVAL", "reason": "Financial or sensitive actions require recent explicit approval.", "limits": {"max_amount_minor": 100000}} if {
  input.capability.sideEffect == "financial"
} else := {"outcome": "REQUIRE_APPROVAL", "reason": "External communication requires approval by default.", "limits": {}} if {
  input.capability.risk == "R2"
} else := {"outcome": "REQUIRE_APPROVAL", "reason": "External communication requires approval by default.", "limits": {}} if {
  input.capability.sideEffect == "external"
} else := {"outcome": "ALLOW_WITH_LIMITS", "reason": "A reversible internal write is allowed within task limits.", "limits": {"max_tool_calls": 20}} if {
  input.capability.risk == "R1"
} else := {"outcome": "DENY", "reason": "The action has no acceptable verification method.", "limits": {}} if {
  input.capability.verificationStrength == "none"
} else := {"outcome": "ALLOW", "reason": "Read-only action allowed by the default policy.", "limits": {}} if {
  input.capability.risk == "R0"
}

authorize := object.union(decision, {"bundleVersion": bundle_version})
