import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Download, FileText, History, Share2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi, signalApiBaseUrl } from "../api/client";
import { getValidAccessToken } from "../auth/token-store";

function safeName(name: string): string {
  return name.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(-180);
}

export function ArtifactCard({ artifactId }: { artifactId: string }) {
  const [history, setHistory] = useState(false);
  const artifact = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: () => signalApi.getArtifact(artifactId),
  });
  const versions = useQuery({
    queryKey: ["artifact-versions", artifactId],
    queryFn: () => signalApi.getArtifactVersions(artifactId),
    enabled: history,
  });
  const download = async (share: boolean) => {
    if (artifact.data === undefined) return;
    const token = await getValidAccessToken();
    if (token === null) throw new Error("Sign in again to download this artifact.");
    const file = new File(Paths.cache, `${artifactId}-${safeName(artifact.data.originalName)}`);
    const downloaded = await File.downloadFileAsync(
      `${signalApiBaseUrl}/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
      file,
      { headers: { authorization: `Bearer ${token}` }, idempotent: true },
    );
    if (share && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(downloaded.uri, { mimeType: artifact.data.mimeType });
    } else {
      Alert.alert("Artifact ready", downloaded.uri);
    }
  };
  if (artifact.isLoading) return null;
  if (artifact.data === undefined) {
    return (
      <Text style={{ color: signalColors.red, marginBottom: signalSpacing.sm }}>
        Artifact metadata is unavailable.
      </Text>
    );
  }
  return (
    <View
      style={{
        backgroundColor: signalColors.surface,
        borderWidth: 1,
        borderColor: signalColors.line,
        borderRadius: signalRadius.md,
        padding: signalSpacing.md,
        marginBottom: signalSpacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: signalSpacing.md }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            backgroundColor: signalColors.blueSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <FileText color={signalColors.blue} size={21} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: signalColors.ink, fontWeight: "800" }}>
            {artifact.data.originalName}
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginTop: 3 }}>
            {artifact.data.mimeType} · {(artifact.data.sizeBytes / 1024).toFixed(1)} KB · v
            {artifact.data.version} · {artifact.data.scanState.toLowerCase()}
          </Text>
        </View>
      </View>
      {artifact.data.warnings.map((warning) => (
        <Text key={warning} style={{ color: signalColors.amber, fontSize: 11, marginTop: 6 }}>
          {warning}
        </Text>
      ))}
      <View style={{ flexDirection: "row", gap: 8, marginTop: signalSpacing.md }}>
        <Pressable
          onPress={() =>
            void download(false).catch((error: unknown) =>
              Alert.alert(
                "Download failed",
                error instanceof Error ? error.message : "The artifact could not be downloaded.",
              ),
            )
          }
          style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 6, padding: 10 }}
        >
          <Download color={signalColors.teal} size={16} />
          <Text style={{ color: signalColors.teal, fontWeight: "700", fontSize: 12 }}>
            Download
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            void download(true).catch((error: unknown) =>
              Alert.alert(
                "Share failed",
                error instanceof Error ? error.message : "The artifact could not be shared.",
              ),
            )
          }
          style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 6, padding: 10 }}
        >
          <Share2 color={signalColors.teal} size={16} />
          <Text style={{ color: signalColors.teal, fontWeight: "700", fontSize: 12 }}>Share</Text>
        </Pressable>
        <Pressable
          onPress={() => setHistory((value) => !value)}
          style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 6, padding: 10 }}
        >
          <History color={signalColors.teal} size={16} />
          <Text style={{ color: signalColors.teal, fontWeight: "700", fontSize: 12 }}>
            Versions
          </Text>
        </Pressable>
      </View>
      {history && (
        <View style={{ borderTopWidth: 1, borderTopColor: signalColors.line, paddingTop: 8 }}>
          {(versions.data?.items ?? []).map((version) => (
            <Text
              key={version.id}
              style={{ color: signalColors.inkMuted, fontSize: 12, marginTop: 4 }}
            >
              v{version.version} · {new Date(version.createdAt).toLocaleString()} ·{" "}
              {version.checksum.slice(0, 20)}…
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
