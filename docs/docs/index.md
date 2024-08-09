# Auralite

Auralite is an AI-powered assistant for Obsidian that helps you manage your ideas and knowledge more effectively.

Read the [get started](get-started.md) guide to set up and get started with Auralite.

Here are the main features and how to use them:

## AI Assistant

The AI Assistant is your always-ready companion in your Obsidian vault, eager to help with various tasks.

### Toggle AI Assistant Listening

The "Toggle AI Assistant Listening" feature activates or deactivates your AI companion. Here's how to use it:

1. Open the command palette with Ctrl/Cmd + P.
2. Type "Toggle AI Assistant Listening" and select it.
3. The AI Assistant is now listening and ready to help.
4. When you're done, repeat the process to turn it off.

Currently, the AI Assistant requires you to turn it off before it performs an action.
It can only perform one action at a time and will not perform multiple actions per activation.

With the AI Assistant active, you can direct it to perform various tasks.
If you ever need it to disregard your instructions and not do anything, you can say something along the lines of "actually, never mind, don't do anything".

### Write

Your AI Assistant can help overcome writer's block by generating content right where you need it. To use this feature:

1. Place your cursor where you want the new content.
2. Activate the AI Assistant if it's not already listening.
3. Ask it to write about a specific topic or continue your thoughts.
4. The AI will generate content, formatted in Markdown, including Obsidian-style links ([[like this]]) and math equations when appropriate.

### Create Note

When you need a new note on a specific topic, the AI can help. Here's how:

1. Ensure the AI Assistant is listening.
2. Ask it to create a new note on your desired topic.
3. Optionally specify how you want the note opened (e.g., new tab, split pane).
4. The AI will generate the note and open it as requested.

If you've set up a default note template in the Auralite settings, the new note will use that template as a starting point.

### Edit

The AI Assistant can help you make specific changes to your current note. To use this feature:

1. Make sure you're in the note you want to edit.
2. Activate the AI Assistant if it's not already listening.
3. Ask it to make a specific change, like "Add a new section about cats" or "Rewrite the second paragraph to be more concise".
4. The AI will make the requested changes while preserving the rest of your note's content.

I've been using this feature to help me write my daily journal. It's been working well for me.

It can even update the note's frontmatter, such as the title and tags. You just have to be specific about what you want it to do.

## Transcription

Auralite can help you transform raw transcriptions into well-formatted text.

### Transcribe

To use the transcribe feature:

1. Open the command palette and select "Transcribe".
2. Speak what's on your mind.
3. The AI will format the transcription for better readability.
4. The formatted result will appear at your cursor's location.

## Utility Commands

### Cancel Ongoing Operation

If you need to stop an AI task in progress:

1. Open the command palette.
2. Select "Cancel Ongoing Operation".
3. The current AI task will immediately stop.

## Silence Detection

Auralite can automatically stop recording after a period of silence. This is so you don't have to manually stop the recording. 

To use this feature:
1. Enable Silence Detection in the Auralite settings.
2. Adjust the silence duration to your preference (e.g., 2 seconds).
3. When using the Transcribe feature, Auralite will automatically stop recording if it detects silence for the specified duration.

It is recommended that you do not use this feature unless you need to. It is better to manually stop the recording.

## Tips for Using Auralite

1. **Be specific**: When asking the AI to write or create notes, provide clear instructions for best results. It can take context from your notes, so be specific about what you want it to do. For example, you can say that you have selected some text, or refer to the current note, and ask it to use that context.
2. **Experiment**: Try different ways of interacting with the AI to find what works best for your workflow.
3. **Use Markdown**: Remember that the AI understands and uses Markdown, so you can ask for formatted content, lists, headers, etc.
4. **Math and Equations**: For complex math, ask the AI to use LaTeX syntax between $$ symbols.

Enjoy using Auralite to enhance your Obsidian experience!