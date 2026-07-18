import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Linking from "expo-linking";
import * as LocalAuthentication from "expo-local-authentication";
import * as Sharing from "expo-sharing";
import { Check, ChevronLeft } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Connection, Settings } from "@signal/contracts";
import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi, signalApiBaseUrl } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { cacheBiometricLock } from "../auth/biometric-lock";
import { useSignalStore } from "../state/use-signal-store";

export type SettingsRoute =
  | "account"
  | "connections"
  | "memory"
  | "permissions"
  | "approvals"
  | "devices"
  | "notifications"
  | "security"
  | "privacy"
  | "developer";

const titles: Record<SettingsRoute, string> = {
  account: "Account & sessions",
  connections: "Connections",
  memory: "Memory",
  permissions: "Permissions",
  approvals: "Approval rules",
  devices: "Device access",
  notifications: "Notifications",
  security: "Security",
  privacy: "Privacy & data",
  developer: "Developer",
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: signalColors.surface,
        borderRadius: signalRadius.md,
        borderWidth: 1,
        borderColor: signalColors.line,
        padding: signalSpacing.md,
        marginBottom: signalSpacing.md,
      }}
    >
      {children}
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: signalColors.inkMuted,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0.9,
        marginTop: signalSpacing.sm,
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}

function Button({
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        borderRadius: signalRadius.md,
        paddingHorizontal: signalSpacing.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: danger ? signalColors.redSoft : signalColors.tealSoft,
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      <Text style={{ color: danger ? signalColors.red : signalColors.tealDark, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: signalSpacing.md,
        paddingVertical: 9,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: signalColors.ink, fontWeight: "700" }}>{label}</Text>
        <Text style={{ color: signalColors.inkMuted, fontSize: 11, lineHeight: 16, marginTop: 3 }}>
          {detail}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: signalColors.teal }} />
    </View>
  );
}

function useSettingsMutation() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: signalApi.getSettings });
  const update = useMutation({
    mutationFn: (patch: Partial<Omit<Settings, "version" | "updatedAt">>) => {
      if (settings.data === undefined) throw new Error("Settings are still loading.");
      return signalApi.updateSettings(settings.data, patch);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      void cacheBiometricLock(next.biometricLock);
    },
    onError: (error: Error) => Alert.alert("Settings not saved", error.message),
  });
  return { settings: settings.data, update };
}

function AccountPanel() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const activeTenantId = useSignalStore((state) => state.activeTenantId);
  const setActiveTenant = useSignalStore((state) => state.setActiveTenant);
  const account = useQuery({ queryKey: ["account"], queryFn: signalApi.getAccount });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: signalApi.listSessions });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: signalApi.listOrganizations,
  });
  const [displayName, setDisplayName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"administrator" | "member" | "auditor">("member");
  const save = useMutation({
    mutationFn: () => signalApi.updateAccount({ displayName }),
    onSuccess: (next) => {
      queryClient.setQueryData(["account"], next);
      setDisplayName("");
    },
    onError: (error: Error) => Alert.alert("Profile not saved", error.message),
  });
  const revoke = useMutation({
    mutationFn: signalApi.revokeSession,
    onSuccess: () => sessions.refetch(),
  });
  const invite = useMutation({
    mutationFn: () => signalApi.inviteOrganizationMember(inviteEmail, inviteRole),
    onSuccess: (result) => {
      const developmentLink =
        result.developmentToken === undefined || account.data === undefined
          ? ""
          : `\n\nDevelopment link: ${signalApiBaseUrl}/invite?tenantId=${encodeURIComponent(account.data.tenantId)}&token=${encodeURIComponent(result.developmentToken)}`;
      Alert.alert(
        "Invitation created",
        `The invitation expires ${new Date(result.expiresAt).toLocaleString()}.${developmentLink}`,
      );
      setInviteEmail("");
    },
    onError: (error: Error) => Alert.alert("Invitation not sent", error.message),
  });
  return (
    <>
      <Label>PROFILE</Label>
      <Card>
        <Text style={{ color: signalColors.ink, fontSize: 18, fontWeight: "800" }}>
          {account.data?.displayName ?? "Loading…"}
        </Text>
        <Text style={{ color: signalColors.inkMuted, marginTop: 4 }}>
          {account.data?.email ?? "Email managed by identity provider"}
        </Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Update display name"
          placeholderTextColor={signalColors.inkMuted}
          style={{
            height: 44,
            borderWidth: 1,
            borderColor: signalColors.line,
            borderRadius: signalRadius.sm,
            paddingHorizontal: 12,
            marginVertical: 12,
            color: signalColors.ink,
          }}
        />
        <Button
          label="Save profile"
          disabled={displayName.trim().length === 0}
          onPress={() => save.mutate()}
        />
      </Card>
      <Label>ORGANIZATION</Label>
      {(organizations.data?.items ?? []).map((organization) => (
        <Card key={organization.tenantId}>
          <Text style={{ color: signalColors.ink, fontWeight: "800" }}>{organization.name}</Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 12, marginTop: 4 }}>
            {organization.role.replaceAll("_", " ")} · {organization.status}
          </Text>
          <View style={{ marginTop: 10 }}>
            <Button
              label={
                (activeTenantId ?? account.data?.tenantId) === organization.tenantId
                  ? "Current workspace"
                  : "Switch workspace"
              }
              disabled={(activeTenantId ?? account.data?.tenantId) === organization.tenantId}
              onPress={() => {
                setActiveTenant(organization.tenantId);
                queryClient.clear();
              }}
            />
          </View>
        </Card>
      ))}
      <Card>
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>Invite a member</Text>
        <TextInput
          value={inviteEmail}
          onChangeText={setInviteEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="person@example.com"
          placeholderTextColor={signalColors.inkMuted}
          style={{
            height: 44,
            borderWidth: 1,
            borderColor: signalColors.line,
            borderRadius: signalRadius.sm,
            paddingHorizontal: 12,
            marginVertical: 10,
            color: signalColors.ink,
          }}
        />
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
          {(["member", "administrator", "auditor"] as const).map((role) => (
            <Pressable
              key={role}
              onPress={() => setInviteRole(role)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: signalRadius.sm,
                backgroundColor: inviteRole === role ? signalColors.teal : signalColors.canvas,
              }}
            >
              <Text
                style={{
                  color: inviteRole === role ? signalColors.surface : signalColors.inkMuted,
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: "800",
                }}
              >
                {role}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button
          label={invite.isPending ? "Sending…" : "Send invitation"}
          disabled={inviteEmail.trim().length === 0 || invite.isPending}
          onPress={() => invite.mutate()}
        />
      </Card>
      <Label>ACTIVE SESSIONS</Label>
      {(sessions.data?.items ?? []).map((session) => (
        <Card key={session.id}>
          <Text style={{ color: signalColors.ink, fontWeight: "700" }}>
            {session.current ? "This session" : (session.deviceId ?? "Unlinked device")}
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginVertical: 6 }}>
            Last seen {new Date(session.lastSeenAt).toLocaleString()}
            {session.revokedAt === null ? "" : " · revoked"}
          </Text>
          {!session.current && session.revokedAt === null && (
            <Button label="Revoke session" danger onPress={() => revoke.mutate(session.id)} />
          )}
        </Card>
      ))}
      <Button
        label="Sign out on this device"
        danger
        onPress={() => {
          setActiveTenant(null);
          queryClient.clear();
          void auth.signOut();
        }}
      />
    </>
  );
}

function ConnectionsPanel() {
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: signalApi.listConnections,
    refetchInterval: 5_000,
  });
  const connect = useMutation({
    mutationFn: (provider: "google" | "github") =>
      signalApi.linkConnection({
        provider,
        toolkit: provider,
        requestedScopes:
          provider === "google"
            ? [
                "openid",
                "email",
                "https://www.googleapis.com/auth/calendar.events",
                "https://www.googleapis.com/auth/gmail.readonly",
              ]
            : ["read:user", "repo"],
        returnDeepLink: "signal://settings/connections",
      }),
    onSuccess: ({ redirectUrl }) => Linking.openURL(redirectUrl),
    onError: (error: Error) => Alert.alert("Connection not started", error.message),
  });
  const status = useMutation<
    Connection | { state: string; redirectUrl: string; expiresAt: string },
    Error,
    { id: string; action: "enable" | "disable" | "reauthenticate" | "revoke" }
  >({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "enable" | "disable" | "reauthenticate" | "revoke";
    }) =>
      action === "reauthenticate"
        ? signalApi.reauthenticateConnection(id)
        : signalApi.setConnectionStatus(id, action),
    onSuccess: (result) => {
      if ("redirectUrl" in result) void Linking.openURL(result.redirectUrl);
      else void connections.refetch();
    },
  });
  return (
    <>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: signalSpacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button label="Connect Google" onPress={() => connect.mutate("google")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Connect GitHub" onPress={() => connect.mutate("github")} />
        </View>
      </View>
      {(connections.data?.items ?? []).map((connection) => (
        <Card key={connection.id}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: signalColors.ink, fontWeight: "800" }}>
                {connection.accountLabel}
              </Text>
              <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginTop: 3 }}>
                {connection.provider} · {connection.source} · {connection.status.toLowerCase()}
              </Text>
            </View>
            {connection.isDefault && <Check color={signalColors.teal} size={18} />}
          </View>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginVertical: 8 }}>
            {connection.scopes.join(", ") || "No scopes reported"}
          </Text>
          <View style={{ flexDirection: "row", gap: 7 }}>
            {connection.status === "ACTIVE" ? (
              <View style={{ flex: 1 }}>
                <Button
                  label="Disable"
                  onPress={() => status.mutate({ id: connection.id, action: "disable" })}
                />
              </View>
            ) : connection.status === "DISABLED" ? (
              <View style={{ flex: 1 }}>
                <Button
                  label="Enable"
                  onPress={() => status.mutate({ id: connection.id, action: "enable" })}
                />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Button
                  label="Reauthenticate"
                  onPress={() => status.mutate({ id: connection.id, action: "reauthenticate" })}
                />
              </View>
            )}
            {connection.status !== "REVOKED" && (
              <View style={{ flex: 1 }}>
                <Button
                  label="Revoke"
                  danger
                  onPress={() => status.mutate({ id: connection.id, action: "revoke" })}
                />
              </View>
            )}
          </View>
        </Card>
      ))}
    </>
  );
}

function MemoryPanel() {
  const memories = useQuery({ queryKey: ["memories"], queryFn: signalApi.listMemories });
  const account = useQuery({ queryKey: ["account"], queryFn: signalApi.getAccount });
  const [search, setSearch] = useState("");
  const [newMemory, setNewMemory] = useState("");
  const visible = useMemo(
    () =>
      (memories.data?.items ?? []).filter((memory) =>
        memory.canonicalText.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
    [memories.data?.items, search],
  );
  const create = useMutation({
    mutationFn: () => {
      if (account.data === undefined) throw new Error("Account is still loading.");
      const now = new Date().toISOString();
      return signalApi.createMemory({
        kind: "semantic_fact",
        subject: "user",
        predicate: "explicit_note",
        object: newMemory.trim(),
        canonicalText: newMemory.trim(),
        scope: { type: "user", id: account.data.id },
        sensitivity: "internal",
        validFrom: now,
        validTo: null,
        expiresAt: null,
        sourceIds: ["mobile.explicit"],
      });
    },
    onSuccess: () => {
      setNewMemory("");
      void memories.refetch();
    },
    onError: (error: Error) => Alert.alert("Memory not saved", error.message),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      signalApi.updateMemory(id, patch),
    onSuccess: () => memories.refetch(),
  });
  const remove = useMutation({
    mutationFn: signalApi.deleteMemory,
    onSuccess: () => memories.refetch(),
  });
  return (
    <>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search saved and proposed memory"
        placeholderTextColor={signalColors.inkMuted}
        style={{
          height: 46,
          borderWidth: 1,
          borderColor: signalColors.line,
          borderRadius: signalRadius.md,
          paddingHorizontal: 12,
          color: signalColors.ink,
          backgroundColor: signalColors.surface,
          marginBottom: 8,
        }}
      />
      <Card>
        <TextInput
          value={newMemory}
          onChangeText={setNewMemory}
          multiline
          placeholder="Explicitly save a fact, preference, or procedure"
          placeholderTextColor={signalColors.inkMuted}
          style={{ minHeight: 64, color: signalColors.ink }}
        />
        <Button
          label="Save explicit memory"
          disabled={newMemory.trim().length === 0}
          onPress={() => create.mutate()}
        />
      </Card>
      {visible.map((memory) => (
        <Card key={memory.id}>
          <Text style={{ color: signalColors.ink, fontWeight: "700", lineHeight: 20 }}>
            {memory.canonicalText}
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginVertical: 7 }}>
            {memory.kind.replaceAll("_", " ")} · {memory.scope.type} · {memory.status} ·{" "}
            {memory.sensitivity}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {memory.status === "proposed" ? (
              <>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Confirm"
                    onPress={() => update.mutate({ id: memory.id, patch: { status: "active" } })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Dispute"
                    danger
                    onPress={() => update.mutate({ id: memory.id, patch: { status: "disputed" } })}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={{ flex: 1 }}>
                  <Button
                    label={memory.pinned ? "Unpin" : "Pin"}
                    onPress={() =>
                      update.mutate({ id: memory.id, patch: { pinned: !memory.pinned } })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Forget" danger onPress={() => remove.mutate(memory.id)} />
                </View>
              </>
            )}
          </View>
        </Card>
      ))}
    </>
  );
}

const capabilityClasses = [
  "communications",
  "financial",
  "browser",
  "code_adaptation",
  "device",
  "file_sharing",
];

function PermissionsPanel() {
  const { settings, update } = useSettingsMutation();
  if (settings === undefined) return null;
  return (
    <Card>
      {capabilityClasses.map((capability) => {
        const enabled = !settings.disabledCapabilityClasses.includes(capability);
        return (
          <Toggle
            key={capability}
            label={capability.replaceAll("_", " ")}
            detail="A provider grant never overrides this Signal permission."
            value={enabled}
            onChange={(next) =>
              update.mutate({
                disabledCapabilityClasses: next
                  ? settings.disabledCapabilityClasses.filter((item) => item !== capability)
                  : [...settings.disabledCapabilityClasses, capability],
              })
            }
          />
        );
      })}
    </Card>
  );
}

const approvalChoices = ["DENY", "REQUIRE_APPROVAL", "ALLOW_WITH_LIMITS", "ALLOW"] as const;

function ApprovalsPanel() {
  const { settings, update } = useSettingsMutation();
  if (settings === undefined) return null;
  return (
    <>
      {(["R0", "R1", "R2", "R3", "R4"] as const).map((risk) => (
        <Card key={risk}>
          <Text style={{ color: signalColors.ink, fontWeight: "900" }}>{risk}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {approvalChoices.map((choice) => (
              <Pressable
                key={choice}
                onPress={() =>
                  update.mutate({
                    approvalDefaults: { ...settings.approvalDefaults, [risk]: choice },
                  })
                }
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 8,
                  borderRadius: signalRadius.pill,
                  backgroundColor:
                    settings.approvalDefaults[risk] === choice
                      ? signalColors.teal
                      : signalColors.canvas,
                }}
              >
                <Text
                  style={{
                    color:
                      settings.approvalDefaults[risk] === choice
                        ? signalColors.surface
                        : signalColors.inkMuted,
                    fontSize: 10,
                    fontWeight: "800",
                  }}
                >
                  {choice.replaceAll("_", " ")}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ))}
    </>
  );
}

const devicePermissions = [
  "contacts",
  "calendar",
  "files",
  "photos",
  "camera",
  "microphone",
  "location",
  "notifications",
  "home",
];

function DevicesPanel() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: signalApi.listDevices });
  const update = useMutation({
    mutationFn: ({
      id,
      permissions,
    }: {
      id: string;
      permissions: Record<string, "granted" | "denied" | "prompt">;
    }) => signalApi.updateDevicePermissions(id, permissions),
    onSuccess: () => devices.refetch(),
  });
  const revoke = useMutation({
    mutationFn: signalApi.revokeDevice,
    onSuccess: () => devices.refetch(),
  });
  return (
    <>
      {(devices.data?.items ?? []).map((device) => (
        <Card key={device.id}>
          <Text style={{ color: signalColors.ink, fontSize: 17, fontWeight: "800" }}>
            {device.displayName}
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginVertical: 7 }}>
            {device.platform} · {device.status} · last seen{" "}
            {new Date(device.lastSeenAt).toLocaleString()}
          </Text>
          {devicePermissions.map((permission) => (
            <Toggle
              key={permission}
              label={permission}
              detail="Standing device permission; the OS may still require foreground consent."
              value={device.permissions[permission] === "granted"}
              onChange={(granted) =>
                update.mutate({
                  id: device.id,
                  permissions: {
                    ...device.permissions,
                    [permission]: granted ? "granted" : "denied",
                  },
                })
              }
            />
          ))}
          <Button label="Revoke device" danger onPress={() => revoke.mutate(device.id)} />
        </Card>
      ))}
    </>
  );
}

function NotificationsPanel() {
  const { settings, update } = useSettingsMutation();
  if (settings === undefined) return null;
  const choices: [keyof Settings["notifications"], string][] = [
    ["actionRequired", "Action required"],
    ["reminders", "Reminders"],
    ["taskCompletion", "Task completion"],
    ["taskFailure", "Task failure"],
    ["securityEvents", "Security events"],
  ];
  return (
    <>
      <Card>
        {choices.map(([key, label]) => (
          <Toggle
            key={key}
            label={label}
            detail="Privacy-safe push notification."
            value={settings.notifications[key]}
            onChange={(value) =>
              update.mutate({ notifications: { ...settings.notifications, [key]: value } })
            }
          />
        ))}
      </Card>
      <Card>
        <Toggle
          label="Quiet hours"
          detail={`${settings.quietHours.startLocal}–${settings.quietHours.endLocal} local time; urgent R3/R4 requests bypass quiet hours.`}
          value={settings.quietHours.enabled}
          onChange={(enabled) => update.mutate({ quietHours: { ...settings.quietHours, enabled } })}
        />
      </Card>
    </>
  );
}

function SecurityPanel() {
  const { settings, update } = useSettingsMutation();
  const security = useQuery({
    queryKey: ["account-security"],
    queryFn: signalApi.getAccountSecurity,
  });
  const stop = useMutation({
    mutationFn: () => signalApi.emergencyStop("Emergency stop from Security settings."),
    onSuccess: ({ affectedTaskIds }) =>
      Alert.alert(
        "Privileged work stopped",
        `${affectedTaskIds.length} task(s) moved to a safe state.`,
      ),
  });
  if (settings === undefined) return null;
  return (
    <>
      <Card>
        <Toggle
          label="Biometric app lock"
          detail="Require device authentication before sensitive local access."
          value={settings.biometricLock}
          onChange={(biometricLock) => {
            if (!biometricLock) {
              update.mutate({ biometricLock: false });
              return;
            }
            void Promise.all([
              LocalAuthentication.hasHardwareAsync(),
              LocalAuthentication.isEnrolledAsync(),
            ]).then(([hardware, enrolled]) => {
              if (!hardware || !enrolled) {
                Alert.alert(
                  "Device authentication unavailable",
                  "Enroll Face ID, Touch ID, fingerprint, or a device credential before enabling the app lock.",
                );
                return;
              }
              update.mutate({ biometricLock: true });
            });
          }}
        />
      </Card>
      <Card>
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>
          Passkeys and sign-in methods
        </Text>
        <Text style={{ color: signalColors.inkMuted, fontSize: 12, marginVertical: 8 }}>
          Passkeys are registered and revoked by the configured identity provider.
        </Text>
        <Button
          label="Manage passkeys"
          onPress={() =>
            security.data !== undefined &&
            void Linking.openURL(security.data.manageSignInMethodsUrl)
          }
        />
      </Card>
      <Button label="Emergency stop privileged work" danger onPress={() => stop.mutate()} />
    </>
  );
}

function PrivacyPanel() {
  const { settings, update } = useSettingsMutation();
  const auth = useAuth();
  const exportData = useMutation({
    mutationFn: async () => {
      await auth.reauthenticate();
      const created = await signalApi.createDataExport();
      const data = await signalApi.readDataExport(created.id);
      const file = new File(Paths.cache, `signal-export-${created.id}.json`);
      file.create({ overwrite: true, intermediates: true });
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
      return created;
    },
    onError: (error: Error) => Alert.alert("Export failed", error.message),
  });
  const deleteAccount = useMutation({
    mutationFn: async () => {
      await auth.reauthenticate();
      return signalApi.deleteAccount("DELETE");
    },
    onSuccess: ({ executeAfter, status }) => {
      Alert.alert(
        "Deletion requested",
        `${status}. Scheduled for ${new Date(executeAfter).toLocaleString()}.`,
      );
      if (status === "scheduled") void auth.signOut();
    },
    onError: (error: Error) => Alert.alert("Deletion not scheduled", error.message),
  });
  if (settings === undefined) return null;
  return (
    <>
      <Card>
        <Toggle
          label="Implicit memory"
          detail="Allow low-sensitivity inferred candidates; ambiguous or sensitive candidates still require confirmation."
          value={settings.implicitMemory}
          onChange={(implicitMemory) => update.mutate({ implicitMemory })}
        />
        <Toggle
          label="Provider improvement"
          detail="Off keeps model use at the minimum required processing policy."
          value={settings.modelDataPolicy === "allow_provider_improvement"}
          onChange={(enabled) =>
            update.mutate({
              modelDataPolicy: enabled ? "allow_provider_improvement" : "minimum_required",
            })
          }
        />
      </Card>
      <Card>
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>Retention</Text>
        <Text style={{ color: signalColors.inkMuted, marginVertical: 8 }}>
          {settings.retentionDays} days · region {settings.processingRegion}
        </Text>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {[30, 90, 365, 730].map((days) => (
            <Pressable
              key={days}
              onPress={() => update.mutate({ retentionDays: days })}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: signalRadius.sm,
                backgroundColor:
                  settings.retentionDays === days ? signalColors.teal : signalColors.canvas,
              }}
            >
              <Text
                style={{
                  color:
                    settings.retentionDays === days ? signalColors.surface : signalColors.inkMuted,
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: "800",
                }}
              >
                {days}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <View style={{ gap: 8 }}>
        <Button
          label={exportData.isPending ? "Preparing export…" : "Export my data"}
          disabled={exportData.isPending}
          onPress={() => exportData.mutate()}
        />
        <Button
          label="Delete account"
          danger
          onPress={() =>
            Alert.alert(
              "Schedule account deletion?",
              "Access is disabled immediately. Erasure runs after a seven-day recovery grace period unless legal hold applies.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete account",
                  style: "destructive",
                  onPress: () => deleteAccount.mutate(),
                },
              ],
            )
          }
        />
      </View>
    </>
  );
}

function DeveloperPanel() {
  const { settings, update } = useSettingsMutation();
  const auth = useAuth();
  const registry = useQuery({
    queryKey: ["generated-capabilities"],
    queryFn: signalApi.listGeneratedCapabilities,
    enabled: settings?.developerMode === true,
  });
  const rollback = useMutation({
    mutationFn: async (id: string) => {
      await auth.reauthenticate();
      return signalApi.rollbackGeneratedCapability(
        id,
        "Manual rollback from mobile developer controls.",
      );
    },
    onSuccess: () => registry.refetch(),
    onError: (error: Error) => Alert.alert("Rollback failed", error.message),
  });
  if (settings === undefined) return null;
  return (
    <>
      <Card>
        <Toggle
          label="Developer mode"
          detail="Show generated integration diffs, test reports, and canary state in task traces."
          value={settings.developerMode}
          onChange={(developerMode) => update.mutate({ developerMode })}
        />
      </Card>
      <Card>
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>Control plane</Text>
        <Text selectable style={{ color: signalColors.inkMuted, marginVertical: 8 }}>
          {signalApiBaseUrl}
        </Text>
        <Button
          label="Open API documentation"
          onPress={() => void Linking.openURL(`${signalApiBaseUrl}/docs`)}
        />
      </Card>
      <Card>
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>Custom integrations</Text>
        <Text
          style={{ color: signalColors.inkMuted, fontSize: 12, lineHeight: 18, marginVertical: 8 }}
        >
          Generated adapters remain sandboxed and inactive until tests, diff approval, signature,
          and tenant canary succeed.
        </Text>
        {!settings.developerMode ? (
          <Text style={{ color: signalColors.inkMuted, fontSize: 12 }}>
            Enable Developer mode to inspect the tenant registry.
          </Text>
        ) : registry.data?.items.length === 0 ? (
          <Text style={{ color: signalColors.inkMuted, fontSize: 12 }}>
            No generated candidates yet.
          </Text>
        ) : (
          registry.data?.items.map((candidate) => (
            <View
              key={candidate.id}
              style={{
                borderTopWidth: 1,
                borderTopColor: signalColors.line,
                paddingVertical: 10,
                gap: 4,
              }}
            >
              <Text style={{ color: signalColors.ink, fontWeight: "700" }}>
                {candidate.gap.requiredAction ?? candidate.logicalPackagePath}
              </Text>
              <Text style={{ color: signalColors.inkMuted, fontSize: 11 }}>
                {candidate.version} · {candidate.status.replaceAll("_", " ")} ·{" "}
                {candidate.stages.filter((stage) => stage.result?.passed).length} gate(s)
              </Text>
              <Text selectable style={{ color: signalColors.inkMuted, fontSize: 10 }}>
                {candidate.candidateDigest}
              </Text>
              {candidate.status === "ACTIVE" ? (
                <Button
                  danger
                  label={rollback.isPending ? "Rolling back…" : "Roll back active version"}
                  onPress={() =>
                    Alert.alert(
                      "Roll back capability?",
                      "The previous active version will be restored when available.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Roll back",
                          style: "destructive",
                          onPress: () => rollback.mutate(candidate.id),
                        },
                      ],
                    )
                  }
                />
              ) : null}
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function Panel({ route }: { route: SettingsRoute }) {
  switch (route) {
    case "account":
      return <AccountPanel />;
    case "connections":
      return <ConnectionsPanel />;
    case "memory":
      return <MemoryPanel />;
    case "permissions":
      return <PermissionsPanel />;
    case "approvals":
      return <ApprovalsPanel />;
    case "devices":
      return <DevicesPanel />;
    case "notifications":
      return <NotificationsPanel />;
    case "security":
      return <SecurityPanel />;
    case "privacy":
      return <PrivacyPanel />;
    case "developer":
      return <DeveloperPanel />;
  }
}

export function SettingsDetail({
  route,
  onClose,
}: {
  route: SettingsRoute | null;
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={route !== null} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: signalColors.canvas, paddingTop: insets.top }}>
        <View
          style={{
            height: 58,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: signalSpacing.md,
            borderBottomWidth: 1,
            borderBottomColor: signalColors.line,
          }}
        >
          <Pressable
            accessibilityLabel="Back to Settings"
            onPress={onClose}
            style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft color={signalColors.ink} />
          </Pressable>
          <Text style={{ flex: 1, color: signalColors.ink, fontSize: 18, fontWeight: "900" }}>
            {route === null ? "Settings" : titles[route]}
          </Text>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: signalSpacing.lg, paddingBottom: insets.bottom + 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {route === null ? null : <Panel route={route} />}
        </ScrollView>
      </View>
    </Modal>
  );
}
