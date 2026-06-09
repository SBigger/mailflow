// src/components/HighlightedText.tsx
import React from 'react';

interface HighlightedTextProps {
    text: string;
    searchQuery: string;
}

export default function HighlightedText({ text, searchQuery }: HighlightedTextProps) {
    if (!searchQuery.trim() || !text) return <>{text};</>;

    const cleanText = text.replace(/^Dokumentenname:.*?\nDateityp:.*?\nInhalt:\n/is, '');
    // 1. Get individual clean search terms (ignoring short fill words)
    const searchTerms = searchQuery
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (searchTerms.length === 0) return <>{text}</>;

    // 2. Build the matching Regex
    const regex = new RegExp(`(${searchTerms.join('|')})`, 'gi');

    // 3. Break the full text block into an array of individual words
    const allWords = cleanText.split(/\s+/);

    // 4. Find the index of the first word that matches any of our search terms
    const matchWordIndex = allWords.findIndex(word => regex.test(word));

    // If no exact word match is found (e.g. vector semantic match), fall back to showing the beginning
    if (matchWordIndex === -1) {
        return <>{allWords.slice(0, 5).join(' ')}...</>;
    }

    // 5. Calculate window: 2 words before and 2 words after
    const startIndex = Math.max(0, matchWordIndex - 2);
    const endIndex = Math.min(allWords.length, matchWordIndex + 3); // +3 because slice is exclusive

    const snippetWords = allWords.slice(startIndex, endIndex);
    const snippetText = snippetWords.join(' ');

    // 6. Split the small snippet to inject the HTML <mark> tags safely
    const parts = snippetText.split(regex);

    return (
        <span>
      {startIndex > 0 && '... '}
            {parts.map((part, index) =>
                regex.test(part) ? (
                    <mark key={index} className="bg-yellow-200 text-gray-900 rounded-sm px-1 font-semibold">
                        {part}
                    </mark>
                ) : (
                    part
                )
            )}
            {endIndex < allWords.length && ' ...'}
    </span>
    );
}