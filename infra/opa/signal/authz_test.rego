package signal

fixture(risk, side_effect, verification) := {
  "principal": {"userId": "usr_demo0001", "tenantId": "ten_demo0001", "roles": ["owner"], "delegatedUserId": null},
  "task": {"id": "tsk_demo0001", "objective": "fixture", "risk": risk},
  "capability": {"name": "fixture.action", "version": "1.0.0", "risk": risk, "sideEffect": side_effect, "verificationStrength": verification},
  "connection": null,
  "target": {"provider": "fixture", "domain": null, "recipient": null, "merchant": null, "account": null},
  "dataClasses": ["internal"],
  "amount": null,
  "occurredAt": "2026-07-18T00:00:00Z",
  "materialPayload": {}
}

test_r0_allowed if {
  result := authorize with input as fixture("R0", "none", "independent")
  result.outcome == "ALLOW"
}

test_r2_requires_approval if {
  result := authorize with input as fixture("R2", "external", "independent")
  result.outcome == "REQUIRE_APPROVAL"
}

test_r1_is_limited if {
  result := authorize with input as fixture("R1", "reversible", "independent")
  result.outcome == "ALLOW_WITH_LIMITS"
  result.limits.max_tool_calls == 20
}

test_r3_requires_approval if {
  result := authorize with input as fixture("R3", "financial", "independent")
  result.outcome == "REQUIRE_APPROVAL"
}

test_r4_requires_elevated_approval if {
  result := authorize with input as fixture("R4", "irreversible", "independent")
  result.outcome == "REQUIRE_MULTI_PARTY_APPROVAL"
  result.limits.approval_threshold == 2
}

test_secret_denied if {
  request := object.union(fixture("R0", "none", "independent"), {"dataClasses": ["secret"]})
  result := authorize with input as request
  result.outcome == "DENY"
}

test_unverifiable_read_denied if {
  result := authorize with input as fixture("R0", "none", "none")
  result.outcome == "DENY"
}

test_generated_adapter_requires_approval_and_canary if {
  request := object.union(fixture("R1", "reversible", "independent"), {
    "capability": {
      "name": "generated.example.read",
      "version": "1.0.0",
      "risk": "R1",
      "sideEffect": "reversible",
      "verificationStrength": "independent"
    }
  })
  result := authorize with input as request
  result.outcome == "REQUIRE_APPROVAL"
  result.limits.tenant_canary == true
}

test_financial_ceiling_denied if {
  request := object.union(fixture("R3", "financial", "independent"), {
    "amount": {"amountMinor": 100001, "currency": "USD", "cumulativeDailyMinor": 100001}
  })
  result := authorize with input as request
  result.outcome == "DENY"
}

test_emergency_stop_denies_new_lease if {
  request := object.union(fixture("R0", "none", "independent"), {
    "materialPayload": {"emergencyStop": true}
  })
  result := authorize with input as request
  result.outcome == "DENY"
}
