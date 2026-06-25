interface HighlightedTextProps {
    text: string;
    searchQuery: string;
}

export default function HighlightedText({text, searchQuery}: HighlightedTextProps) {
    if (!searchQuery.trim() || !text) return <span style={{fontSize: 11}}>{text}</span>;

    const cleanText = text
        .replace(/^Dokumentenname:[\s\S]*?\nDateityp:[\s\S]*?\nInhalt:\n/i, '')
        .replace(/<\/b>/g, "")
        .replace(/<b>/g, "");
    // 1. Get individual clean search terms (ignoring short fill words)
    const searchTerms = searchQuery
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (searchTerms.length === 0) return <span style={{fontSize: 11}}>{text}</span>;

    // 2. Build the matching Regex
    const regex = new RegExp(`(${searchTerms.join('|')})`, 'gi');

    // 3. Break the full text block into an array of individual words
    const allWords = cleanText.split(/\s+/);

    // 4. Find the index of the first word that matches any of our search terms
    const matchWordIndex = allWords.findIndex(word => regex.test(word));

    // If no exact word match is found (e.g. vector semantic match), fall back to showing the beginning
    if (matchWordIndex === -1) {
        return <span style={{fontSize: 11}}>{allWords.slice(0, 5).join(' ')}...</span>;
    }

    // 5. Calculate window: 2 words before and 2 words after
    const startIndex = Math.max(0, matchWordIndex - 5);
    const endIndex = Math.min(allWords.length, matchWordIndex + 6); // +3 because slice is exclusive

    const snippetWords = allWords.slice(startIndex, endIndex);
    const snippetText = snippetWords.join(' ');

    // 6. Split the small snippet to inject the HTML <mark> tags safely
    const parts = snippetText.split(regex);

    return (
        <span style={{fontSize: 11}}>
      {startIndex > 0 && '... '}
            {parts.map((part, index) =>
                regex.test(part) ? (
                    <mark key={index} className="bg-yellow-200 text-gray-600 rounded-sm px-1">
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