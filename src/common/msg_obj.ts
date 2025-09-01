import {KolCursor} from "../object/kol_cursor";

export class TcMessage {
    __tc: boolean = true;
    from: boolean = true;
    action: string;
    data?: any;

    constructor(act: string, from: boolean = true, d?: any) {
        this.action = act;
        this.from = from;
        this.data = d;
    }
}

// （可选）工具：判定是否我们的消息
export function isTcMessage(x: any): x is TcMessage {
    return !!x && x.__tc && typeof x.action === 'string';
}

export class tweetFetchParam {
    cursors: KolCursor[];
    newest: boolean

    constructor(cursors: KolCursor[], newest: boolean = true) {
        this.cursors = cursors;
        this.newest = newest;
    }
}