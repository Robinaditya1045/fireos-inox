// @ts-nocheck — vendored from Amazon hls-rel v1.5.11-r1.7; kept as shipped.
/*
 * Copyright 2024 Amazon.com, Inc. or its affiliates. All rights reserved.
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

import {PlayerInterface} from "../PlayerInterface";
import {HTMLMediaElement} from "@amazon-devices/react-native-w3cmedia";

export abstract class PlayerBase implements PlayerInterface {
  protected mediaElement : HTMLMediaElement | null;

  constructor (mediaElement: HTMLMediaElement | null) {
    console.log(`PlayerBase: constructor, mediaelement set: ${mediaElement != null}`);
    this.mediaElement = mediaElement;
  }
  async load(content: any, autoplay: boolean): void;

  play(): void {
    this.mediaElement?.play();
  }

  pause(): void {
    this.mediaElement?.pause();
  }

  seekBack(): void {
    const time = this.mediaElement.currentTime;
    console.log("PlayerBase: seekBack to ",  time - 10);
    this.mediaElement.currentTime = time - 10;
  }

  seekFront(): void {
    const time = this.mediaElement.currentTime;
    console.log("PlayerBase: seekFront to ",  time + 10);
    this.mediaElement.currentTime = time + 10;
  }

  playbackRate(playbackrate: number): void {
    const playbackrate_ = this.mediaElement.playbackRate;
    console.log("PlayerBase: set playbackRate from  " + playbackrate_ + "to" +  playbackrate);
    this.mediaElement.playbackRate = playbackrate;
  }

  volume( volumelevel: number): void {
    const volumeLevel_ = this.mediaElement.volume;
    console.log("PlayerBase: set volume level from  " + volumeLevel_ + "to" +  volumelevel);
    this.mediaElement.volume = volumelevel;
  }

  mute( mute: boolean): void {
    const muted_ = this.mediaElement.muted;
    console.log("PlayerBase: set mute from  " + muted_ + "to" +  mute);
    this.mediaElement.muted = mute;
  }

  async unload(): Promise<void>;

  getAudioLanguages(): string [] {
    return [];
  }

  destroy(): void {
  }

  selectAudioLanguage(language: string): void {
  }

  getTextTracks(): TextTrackInfo[] {
    let textTrackInfoList : TextTrackInfo[] = [];

    let textTrackList = this.mediaElement?.textTracks;
    if (textTrackList) {
      for (let track of textTrackList) {
        textTrackInfoList.push({
          id: track.id,
          kind: track.kind,
          language: track.language,
          label: track.label,
          mode: track.mode,
          playerTrackData : ({track: track}),
        });
      }
    }
    console.log(`PlayerBase: getTextTracks length=${textTrackInfoList.length}`);
    return textTrackInfoList;
  }

  async setTextTrack(newTrack: TextTrackInfo|null, currTrack: TextTrackInfo|null): void {
    if (currTrack) {
      console.log(`PlayerBase:setTextTrack: disable native track id ${currTrack.id}`);
      currTrack.playerTrackData.track.mode = 'hidden';
    }
    if (newTrack) {
      console.log(`PlayerBase:setTextTrack: enable native track id ${newTrack.id}`);
      newTrack.playerTrackData.track.mode = 'showing';
    }
  }

  loadOOBSubtitles(content: any) : void {
    if (!content || !content.subtitles) {
      console.log('PlayerBase: loadOOBSubtitles no subtitle in content');
      return;
    }
    console.log(`PlayerBase: loadOOBSubtitles uri=${content.uri}`);
    if (this.mediaElement) {
      for (let subtitle of content.subtitles) {
        console.log(`PlayerBase:loadOOBSubtitles add subtitle uri: ${subtitle.uri},
            lang: ${subtitle.language}, label: ${subtitle.label}, mime: ${subtitle.mime_type}`);
        this.mediaElement.addTextTrack("subtitles", subtitle.label,
            subtitle.language, subtitle.uri, subtitle.mime_type);
      }
    }
  }

  addPlayerEventListener(type: string, listener: any, options?: any): void {
  }

  removePlayerEventListener(type: string, listener: any, options?: any): void {
  }
}
