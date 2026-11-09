import { createContext, useContext } from 'react';

/** Sends a follow-up prompt into the chat; undefined when the surface cannot send one. */
export type PromptHandler = ((prompt: string) => void) | undefined;

export const PromptContext = createContext<PromptHandler>(undefined);

export function usePrompt(): PromptHandler {
  return useContext(PromptContext);
}
