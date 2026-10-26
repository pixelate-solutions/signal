import * as DocumentPicker from "expo-document-picker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { ArrowUp, Camera, FilePlus2, Images, Mic, ScanLine, Square, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from "react-native";

import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import type { LocalAttachment } from "../api/upload";

const INPUT_MIN_HEIGHT = 52;
const INPUT_MAX_HEIGHT = 132;

export function Composer({
  sending,
  onSend,
}: {
  sending: boolean;
  onSend(text: string, attachments: LocalAttachment[]): Promise<void>;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const input = useRef<TextInput>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    setAttachments((current) => [
      ...current,
      ...result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 0,
      })),
    ]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission required", "Enable camera access to capture an attachment.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
    const asset = result.assets?.[0];
    if (result.canceled || asset === undefined) return;
    setAttachments((current) => [
      ...current,
      {
        uri: asset.uri,
        name: asset.fileName ?? `camera-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
        size: asset.fileSize ?? 0,
      },
    ]);
  };

  const pickPhotos = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo permission required",
        "Choose photos after enabling selected-photo access.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (result.canceled) return;
    setAttachments((current) => [
      ...current,
      ...result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? `media-${Date.now()}`,
        mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
        size: asset.fileSize ?? 0,
      })),
    ]);
  };

  const scanDocument = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission required", "Enable camera access to scan a document.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 1,
    });
    const asset = result.assets?.[0];
    if (result.canceled || asset === undefined) return;
    setAttachments((current) => [
      ...current,
      {
        uri: asset.uri,
        name: `scan-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
        size: asset.fileSize ?? 0,
      },
    ]);
  };

  const toggleVoice = async () => {
    if (recorderState.isRecording) {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri !== null) {
        const file = new File(uri);
        setAttachments((current) => [
          ...current,
          {
            uri,
            name: `voice-${Date.now()}.m4a`,
            mimeType: "audio/mp4",
            size: file.size ?? 0,
          },
        ]);
        if (text.trim().length === 0) {
          setText("Transcribe this voice note and carry out the requested outcome.");
        }
      }
      await setAudioModeAsync({ allowsRecording: false });
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Microphone permission required",
        "Enable microphone access to attach a voice note.",
      );
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const submit = async () => {
    const objective = text.trim();
    if (objective.length === 0 || sending) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onSend(objective, attachments);
    } catch {
      // The owning mutation displays the actionable API error and preserves this draft for retry.
      return;
    }
    setText("");
    setAttachments([]);
    setInputHeight(INPUT_MIN_HEIGHT);
  };

  const submitFromKeyboard = () => {
    void submit();
    // React Native Web still uses blurOnSubmit for multiline inputs. Restore focus after its
    // deferred blur so desktop users can continue typing like they can in the native app.
    if (Platform.OS === "web") setTimeout(() => input.current?.focus(), 50);
  };

  return (
    <>
      {attachments.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {attachments.map((attachment, index) => (
            <View
              key={`${attachment.uri}-${index}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                maxWidth: "100%",
                backgroundColor: signalColors.tealSoft,
                paddingVertical: 6,
                paddingLeft: 9,
                paddingRight: 5,
                borderRadius: signalRadius.pill,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ color: signalColors.tealDark, fontSize: 12, maxWidth: 220 }}
              >
                {attachment.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
                onPress={() =>
                  setAttachments((current) => current.filter((_, item) => item !== index))
                }
                hitSlop={8}
              >
                <X size={14} color={signalColors.tealDark} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View
        style={{
          backgroundColor: signalColors.surface,
          borderRadius: signalRadius.lg,
          borderWidth: 1,
          borderColor: signalColors.line,
          padding: signalSpacing.sm,
          shadowColor: signalColors.ink,
          shadowOpacity: 0.08,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 7 },
          elevation: 4,
        }}
      >
        <TextInput
          ref={input}
          accessibilityLabel="Task objective"
          multiline
          blurOnSubmit={Platform.OS === "web"}
          maxLength={20_000}
          onContentSizeChange={(event) => {
            const nextHeight = Math.min(
              INPUT_MAX_HEIGHT,
              Math.max(INPUT_MIN_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height)),
            );
            setInputHeight((current) => (current === nextHeight ? current : nextHeight));
          }}
          placeholder="What outcome should Signal handle?"
          placeholderTextColor="#82918C"
          returnKeyType="send"
          scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
          submitBehavior="submit"
          textAlignVertical="top"
          value={text}
          onChangeText={setText}
          onSubmitEditing={submitFromKeyboard}
          style={{
            height: inputHeight,
            minHeight: INPUT_MIN_HEIGHT,
            maxHeight: INPUT_MAX_HEIGHT,
            paddingHorizontal: signalSpacing.sm,
            paddingTop: signalSpacing.sm,
            paddingBottom: signalSpacing.sm,
            color: signalColors.ink,
            fontSize: 16,
            lineHeight: 22,
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach a file"
            onPress={() => void pickDocument()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? signalColors.canvas : "transparent",
            })}
          >
            <FilePlus2 size={20} color={signalColors.inkMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            onPress={() => void takePhoto()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? signalColors.canvas : "transparent",
            })}
          >
            <Camera size={20} color={signalColors.inkMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose photos or video"
            onPress={() => void pickPhotos()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? signalColors.canvas : "transparent",
            })}
          >
            <Images size={20} color={signalColors.inkMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan document"
            onPress={() => void scanDocument()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? signalColors.canvas : "transparent",
            })}
          >
            <ScanLine size={20} color={signalColors.inkMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              recorderState.isRecording ? "Stop voice recording" : "Record voice input"
            }
            onPress={() => void toggleVoice()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: recorderState.isRecording
                ? signalColors.redSoft
                : pressed
                  ? signalColors.canvas
                  : "transparent",
            })}
          >
            {recorderState.isRecording ? (
              <Square size={17} color={signalColors.red} fill={signalColors.red} />
            ) : (
              <Mic size={20} color={signalColors.inkMuted} />
            )}
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start task"
            disabled={text.trim().length === 0 || sending}
            onPress={() => void submit()}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                text.trim().length === 0
                  ? signalColors.line
                  : pressed
                    ? signalColors.tealDark
                    : signalColors.teal,
            })}
          >
            {sending ? (
              <ActivityIndicator color={signalColors.surface} size="small" />
            ) : (
              <ArrowUp size={20} color={signalColors.surface} strokeWidth={2.7} />
            )}
          </Pressable>
        </View>
      </View>
    </>
  );
}
