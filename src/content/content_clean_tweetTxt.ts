// Tweet Text Part Types
export abstract class TweetTextPart {
    abstract toHtml(): string;
    abstract toDom(): Node;
}

export class TextPart extends TweetTextPart {
    constructor(public text: string) {
        super();
    }

    toHtml(): string {
        return this.text;
    }

    toDom(): Node {
        return document.createTextNode(this.text);
    }
}

export class NewlinePart extends TweetTextPart {
    toHtml(): string {
        return '<br>';
    }

    toDom(): Node {
        return document.createElement('br');
    }
}

export class EmojiPart extends TweetTextPart {
    constructor(public text: string) {
        super();
    }

    toHtml(): string {
        return this.text;
    }

    toDom(): Node {
        return document.createTextNode(this.text);
    }
}

export class LinkPart extends TweetTextPart {
    constructor(public text: string, public href: string) {
        super();
    }

    toHtml(): string {
        return `<a href="${this.href}" target="_blank" rel="noopener noreferrer">${this.text}</a>`;
    }

    toDom(): Node {
        const a = document.createElement('a');
        a.href = this.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = this.text;
        return a;
    }
}

export class MentionPart extends LinkPart {}
export class HashtagPart extends LinkPart {}

// Clean Tweet Text Function Plus Version
export function cleanTweetTextV3(
    fullText: string,
    mediaUrls: string[] = [],
    entities: any = {},
    displayTextRange?: [number, number]
): TweetTextPart[] {
    const parts: TweetTextPart[] = [];
    let cursor = 0;
    const entityItems: { start: number; end: number; part: TweetTextPart }[] = [];

    // Adjust fullText based on displayTextRange
    const adjustedFullText = displayTextRange
        ? fullText.slice(displayTextRange[0], displayTextRange[1])
        : fullText;

    // Process URLs
    if (entities.urls) {
        for (const url of entities.urls) {
            entityItems.push({
                start: url.indices[0],
                end: url.indices[1],
                part: new LinkPart(url.display_url, url.expanded_url)
            });
        }
    }

    // Process Hashtags
    if (entities.hashtags) {
        for (const tag of entities.hashtags) {
            const href = `https://twitter.com/hashtag/${encodeURIComponent(tag.text)}`;
            entityItems.push({
                start: tag.indices[0],
                end: tag.indices[1],
                part: new HashtagPart(`#${tag.text}`, href)
            });
        }
    }

    // Process Mentions
    if (entities.user_mentions) {
        for (const mention of entities.user_mentions) {
            const href = `https://twitter.com/${mention.screen_name}`;
            entityItems.push({
                start: mention.indices[0],
                end: mention.indices[1],
                part: new MentionPart(`@${mention.screen_name}`, href)
            });
        }
    }

    // Process Media URLs (to remove them)
    if (entities.media) {
        for (const media of entities.media) {
            entityItems.push({
                start: media.indices[0],
                end: media.indices[1],
                part: null as any // will skip rendering this part
            });
        }
    }

    entityItems.sort((a, b) => a.start - b.start);

    for (const item of entityItems) {
        if (item.start > cursor) {
            parts.push(...splitText(adjustedFullText.slice(cursor, item.start)));
        }
        if (item.part) {
            parts.push(item.part);
        }
        cursor = item.end;
    }

    if (cursor < adjustedFullText.length) {
        parts.push(...splitText(adjustedFullText.slice(cursor)));
    }

    return parts;
}

function splitText(text: string): TweetTextPart[] {
    const parts: TweetTextPart[] = [];
    const lines = text.split(/(\n)/g);
    for (const line of lines) {
        if (line === '\n') {
            parts.push(new NewlinePart());
        } else if (line) {
            parts.push(new TextPart(line));
        }
    }
    return parts;
}

// Rendering Parts to HTML
export function renderPartsAsHtml(parts: TweetTextPart[]): string {
    return parts.map(part => part.toHtml()).join('');
}

// Rendering Parts to DocumentFragment
export function renderPartsAsDom(parts: TweetTextPart[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
        fragment.appendChild(part.toDom());
    }
    return fragment;
}
