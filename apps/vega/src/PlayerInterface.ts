// @ts-nocheck — vendored from Amazon hls-rel v1.5.11-r1.7; kept as shipped.
/*
 * Copyright 2022 Amazon.com, Inc. or its affiliates. All rights reserved.
 *
 * AMAZON PROPRIETARY/CONFIDENTIAL
 *
 * You may not use this file except in compliance with the terms and
 * conditions set forth in the accompanying LICENSE.TXT file.
 *
 * THESE MATERIALS ARE PROVIDED ON AN "AS IS" BASIS. AMAZON SPECIFICALLY
 * DISCLAIMS, WITH RESPECT TO THESE MATERIALS, ALL WARRANTIES, EXPRESS,
 * IMPLIED, OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
 */

export interface TextTrackInfo {
    id: string;
    kind: string;
    language: string;
    label: string;
    mode: string;
    playerTrackData: any;
}

export interface PlayerInterface {
    async load(content: any, autoplay: boolean): void;
    play() : void;
    pause() : void;
    seekBack() : void;
    seekFront() : void;
    async unload() : Promise<void>;
    destroy(): void;
    playbackRate( playbackrate: number) : void;
    volume( volumelevel: number) : void;
    mute( mute: boolean) : void;
    getAudioLanguages(): string[];
    selectAudioLanguage(language: string) : void;
    getTextTracks?: () => TextTrackInfo[];
    async setTextTrack?: (newTrack: TextTrackInfo|null, currTrack: TextTrackInfo|null) => void;
    loadOOBSubtitles?: (content: any) => void;
    addPlayerEventListener?: (type: string, listener: any, options?: any) => void;
    removePlayerEventListener?: (type: string, listener: any, options?: any) => void;
}
