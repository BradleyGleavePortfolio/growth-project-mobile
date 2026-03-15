import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatMessage } from '../types';

const MAX_MESSAGES = 50;

function storageKey(userId: string): string {
  return `gp_chat_${userId}`;
}

export async function getChatHistory(userId: string): Promise<ChatMessage[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  return JSON.parse(raw) as ChatMessage[];
}

export async function saveChatMessage(
  userId: string,
  message: ChatMessage
): Promise<void> {
  const history = await getChatHistory(userId);
  history.push(message);
  const trimmed = history.slice(-MAX_MESSAGES);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
}

export async function clearChatHistory(userId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(userId));
}
