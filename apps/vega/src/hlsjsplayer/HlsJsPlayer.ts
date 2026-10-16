/*
 * Copyright 2024-2025 Amazon.com, Inc. or its affiliates. All rights reserved.
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
// @ts-nocheck

import * as HlsPlayerLib from './dist/hls.mjs'
import { HTMLMediaElement } from "@amazon-devices/react-native-w3cmedia";
import { PlayerInterface } from '../PlayerInterface.js';
import {PlayerBase} from "../PlayerBase";

const playerName: string = "hlsjs";
const playerVersion: string = "1.5.11";

const HlsEventsMap: Map<string,HlsPlayerLib.Events> = new Map([
  ['timedmetadata', HlsPlayerLib.Events.FRAG_PARSING_METADATA],
  ['error', HlsPlayerLib.Events.ERROR]
]);

export class HlsJsPlayer extends PlayerBase {
  private playbackItem: {} = {};
  player: Hls;
  static readonly enableNativeParsing = false;
  constructor(mediaElement: HTMLMediaElement) {
    super(mediaElement);
  }

  registerPlaybackEvents(listener?: any) {
    if (!this.player) {
      console.info('W3cMediaApp::hlsjsplayer: Not initialized');
      return;
    }

    this.player.on(HlsPlayerLib.Events.MANIFEST_LOADED, (event, data): void =>{
      console.debug('W3cMediaApp::hlsjsplayer:Manifest loaded ' + data?.url);
      listener?.();
    });

    this.player.on(HlsPlayerLib.Events.MANIFEST_PARSED, (event, data): void =>{
      console.debug('W3cMediaApp::hlsjsplayer:Manifest parsed');
      listener?.();
    });

    this.player.on(HlsPlayerLib.Events.MEDIA_ATTACHED, (event, data): void =>{
      console.debug('W3cMediaApp::hlsjsplayer:MediaSource attached to MediaElement');
      listener?.();
    });

    this.player.on(HlsPlayerLib.Events.BUFFER_CREATED, (event, data): void =>{
      console.debug('W3cMediaApp::hlsjsplayer:SourceBuffer created');
      listener?.();
    });

    this.player.on(HlsPlayerLib.Events.BUFFER_APPENDED, (event, data): void =>{
      console.debug(`W3cMediaApp::hlsjsplayer:${data?.type} is appended ` + JSON.stringify(data?.timeRanges));
      listener?.();
    });

    this.player.on(HlsPlayerLib.Events.MEDIA_DETACHED, (event, data): void =>{
      console.debug('W3cMediaApp::hlsjsplayer:MediaSource deteached from MediaElement');
      listener?.();
    });

    this.player.on(HlsPlayerLib.Events.DESTROYING, (event, data): void =>{
      console.debug('W3cMediaApp::hlsjsplayer:Player is destroying');
      listener?.();
    });
  }

  registerTimedMetadataEvent(listener: any) {
    if (!this.player) {
      console.log(`W3cMediaApp::hlsjsplayer: Not initialized`);
      return;
    }

    const listenOnMetadataCue = (track: TextTrackImpl) : void => {
      console.debug("W3cMediaApp::hlsjsplayer:Metadata track found");

      track?.addEventListener("cuechange" , (event: Event) : void => {
        const textTrack: TextTrackImpl = event.target as TextTrackImpl;
        const activeCues: TextTrackCueList = textTrack?.activeCues;

        for (const cue of activeCues) {
           if (cue.text.length === 0)
             cue.text = "ID3_" + cue.startTime + "-" + cue.endTime;

           console.info(`W3cMediaApp::hlsjsplayer:Found Active Metadata=${cue.text}, starttime=${cue.startTime},` +
            `endTime=${cue.endTime} and currentTime = ${this.mediaElement.currentTime}`);

           if (listener) {
             listener(cue.text, cue.id, true);
           }

           cue.addEventListener('exit', (event: Event) => {
             const text = (event.target as VTTCue).text;
             const playbackTime: number = this.mediaElement.currentTime;
             console.info(`hlsplayerplayer:Metadata ${text} is In-Active and playback time is ${playbackTime}`);
             if (listener)
               listener(text, (event.target as VTTCue).id, false);
           });
        }
      }); // cuechange
    }

    this.player.on(HlsPlayerLib.Events.FRAG_PARSING_METADATA, (event, data): void =>{
      console.log("W3cMediaApp::hlsjsplayer:ID3 metadata found ->" + JSON.stringify(data.samples));
    });

    this.mediaElement.textTracks.addEventListener("addtrack", (event: Event) => {
      const textTrackList: TextTrackList = this.mediaElement.textTracks;
      for (let i = 0; i < textTrackList.length; i++) {
         const textTrack = textTrackList[i];
         if (textTrack.kind === "metadata") {
           listenOnMetadataCue(textTrack);
         }
      }
    });
  }

  createPlayerInstance = () => {
    let signal_secure: string = 'HW_SECURE_ALL';
    let audio_not_secure: string = 'SW_SECURE_CRYPTO';
    if (this.playbackItem.drm_scheme === 'com.microsoft.playready') {
      signal_secure = '150';
    }
    console.log(`W3cMediaApp::hlsjsplayer: loading with ${this.playbackItem.drm_scheme} and ${this.playbackItem.drm_license_uri} and ${this.playbackItem.secure}`);
    if (this.playbackItem.secure === "true") {
      if (this.playbackItem.drm_scheme === 'com.microsoft.playready') {
        signal_secure = '3000';
      } else {
        signal_secure = 'HW_SECURE_ALL';
      }
    }
    this.player = new HlsPlayerLib.Hls({
      enableWorker: true,
      emeEnabled: true,
      lowLatencyMode: false,
      progressive: false,
      debug: true,
      backBufferLength: 30,
      maxBufferLength: 10,
      maxMaxBufferLength: 30,

      drmSystems: {
        [this.playbackItem.drm_scheme]: {
          licenseUrl: this.playbackItem.drm_license_uri,
        },
      },
      drmSystemOptions: {
        audioRobustness: audio_not_secure,
        videoRobustness: signal_secure,
      },
      requestMediaKeySystemAccessFunc: (keySystem, supportedConfigurations) => {
        console.log(`W3cMediaApp::hlsjsplayer: supportedConfigurations = ${JSON.stringify(supportedConfigurations)}`)
        return window.navigator.requestMediaKeySystemAccess(keySystem, supportedConfigurations);
      }
    });
    console.log('W3cMediaApp::hlsjsplayer:Create instance in Hls player');
  };

  nativeParseLevelPlaylist( manifest: string,
      absoluteuri:string,
      id: number,
      type: HlsPlayerLib.PlaylistLevelType
    ) : HlsPlayerLib.LevelDetails {
    console.log('HlsJs: nativeParseLevelPlaylist +');
    let levels: HlsPlayerLib.LevelDetails = global.parseHlsManifest(
      playerName, playerVersion, absoluteuri, manifest, id, type, HlsPlayerLib);
    console.log(`HlsJs: nativeParseLevelPlaylist -`);
    return levels;
  }

  override async load(content: any, _autoplay: boolean): void {
    console.log("Hlsjs: Load +");
    if (HlsJsPlayer.enableNativeParsing) {
      if (global.registerNativePlayerUtils &&
        HlsPlayerLib.M3U8Parser.setNativeFunctions) {
        console.log("Hlsjs: registerNativePlayerUtils found");
        if (!global.isNativeHlsParserSupported) {
          const ret = global.registerNativePlayerUtils();
          console.log("Hlsjs: native functions registered: " + ret);
        }
        if (global.isNativeHlsParserSupported &&
            global.parseHlsManifest) {
          const nativeHlsParserSupported =
              global.isNativeHlsParserSupported(playerName, playerVersion);
          if (nativeHlsParserSupported) {
            console.log('Hlsjs: setting native functions');
            HlsPlayerLib.M3U8Parser.setNativeFunctions(this.nativeParseLevelPlaylist);
          } else {
            console.log('hlsjs: nativeHlsParser not supported for player version');
          }
        } else {
          console.log('hlsjs: native func not set even after register, skipping it');
        }
      } else {
        console.log(`hlsjs: native offload not enabled!
            registerNativePlayerUtils: ${!!global.registerNativePlayerUtils},
            setNativeFunctions: ${!!HlsPlayerLib.M3U8Parser.setNativeFunctions}`);
      }
    } else {
      console.log(`hlsjs: native playlist parsing is disabled`);
    }

    this.playbackItem = content;

    if (!this.player) {
      this.createPlayerInstance();
      console.log('W3cMediaApp::hlsjsplayer: Creating NEW HLS instance');
    } else {
      console.log('W3cMediaApp::hlsjsplayer: Reusing existing HLS instance');
    }

    console.log('W3cMediaApp::hlsjsplayer:Loading the hls player with content URL:', content.uri);

    this.player.loadSource(content.uri);
    this.player.attachMedia(this.mediaElement);
  };

  override async unload(): void {
    try {
      this.mediaElement?.pause();
      if (this.player) {
        this.player.stopLoad?.();
        this.player.detachMedia?.();
      }
      console.log("W3cMediaApp::hlsjsplayer: Unload completed");
    } catch (err) {
      console.error("Unload error:", err);
    }
  }

  override async destroy(): Promise<void> {
    console.log('W3cMediaApp::hlsjsplayer: Destroy');
    await this.unload();
    await this.player?.destroy();
    this.player = null;
  }

  override getAudioLanguages() : string[] {
    let languages : string[] = [];

    let audiotracks = this.player?.audioTracks;
    languages = audiotracks?.map((track) => (track.lang));

    console.log(`W3cMediaApp::hlsjsplayer: getAudioLanguages ` + JSON.stringify(languages));
    return languages;
  }

  override selectAudioLanguage(language: string): void {
    console.log("W3cMediaApp::hlsjsplayer: set New Audio Language " + language);

    let audiotrack: any = undefined;
    let audiotracks = this.player?.audioTracks;
    audiotracks.forEach((track) => {
      if (track.lang === language)
        audiotrack = track;
    });
    this.player.audioTrack = audiotrack.id;
  }

  override getTextTracks() : TextTrackInfo[] {
    let textTrackInfoList : TextTrackInfo[] = [];
    let js_tracks : TextTrackInfo[] = [];
    let native_tracks : TextTrackInfo[] = [];

    if (this.player) {
      let hlsjsTextTrackList = this.player.subtitleTracks;

      js_tracks = hlsjsTextTrackList.map((track) => ({
        id: 'hlsjs:' + track.id.toString(),
        kind: track.type,
        language: track.lang,
        label: 'HLSJS TextTrack',
        mode: (track.subtitleTrack === track.id ? 'showing' : 'hidden'),
        playerTrackData: ({type: 'hlsjs', track: track}),
      }));
    }

    if (this.mediaElement) {
      let nativeTextTrackList = this.mediaElement.textTracks;

      native_tracks = nativeTextTrackList.filter((track) => track.id.startsWith("NATIVE_"))
        .map((track) => ({
        id: 'native:' + track.id.toString(),
        kind: track.kind,
        language: track.language,
        label: track.label,
        mode: track.mode,
        playerTrackData : ({type: 'native', track: track}),
      }));
    }
    textTrackInfoList = js_tracks.concat(native_tracks);
    console.log(`W3cMediaApp::hlsjsplayer: getTextTracks length=${textTrackInfoList.length}`);
    return textTrackInfoList;
  }

  override async setTextTrack(newTrack: TextTrackInfo|null, currTrack: TextTrackInfo|null) : void {
    if (currTrack) {
      if (currTrack.playerTrackData.type === 'native') {
        console.log(`W3cMediaApp::hlsjsplayer:setTextTrack: disable native track, id ${currTrack.id}`);
        currTrack.playerTrackData.track.mode = 'hidden';
      } else if (currTrack.playerTrackData.type === 'hlsjs') {
        console.log(`W3cMediaApp::hlsjsplayer:setTextTrack: disable hlsjs track, id ${currTrack.id}`);
        this.player.subtitleDisplay = false;
      } else {
        console.warn('W3cMediaApp::hlsjsplayer:setTextTrack: invalid old text track info');
      }
    }

    if (newTrack) {
      if (newTrack.playerTrackData.type === 'native') {
        console.log(`W3cMediaApp::hlsjsplayer:setTextTrack: enable native track, id ${newTrack.id}`);
        newTrack.playerTrackData.track.mode = 'showing';
      } else if (newTrack.playerTrackData.type === 'hlsjs') {
        console.log(`W3cMediaApp::hlsjsplayer:setTextTrack: enable hlsjs track, id ${newTrack.id}`);
        this.player.subtitleTrack = newTrack.playerTrackData.track.id;
        this.player.subtitleDisplay = true;
      } else {
        console.warn('W3cMediaApp::hlsjsplayer:setTextTrack: invalid new text track info');
      }
    }
  }

  override addPlayerEventListener(type: string, listener: any, options?: any) {
    if (!this.player) {
      console.log(`W3cMediaApp::hlsjsplayer: addPlayerEventListener, called when not initialized`);
      return;
    }

    switch (type) {
      case "timedmetadata":
           this.registerTimedMetadataEvent(listener);
           break;
      case "error":
           this.player.on(HlsEventsMap.get(type), (event, data) => {
             if (data?.fatal) {
               listener({
                 playerType: 'HLS',
                 errorCode: data.type,
                 errorMessage: data.details
               });
             }
           });
           break;
      case "debug":
           this.registerPlaybackEvents(listener);
           break;
      default:
           if (HlsEventsMap.has(type)) {
             this.player.on(HlsEventsMap.get(type), (event, data) => listener(data));
           } else {
             console.log(`W3cMediaApp::hlsjsplayer:${type} Mapping is not available`);
           }
           break;
    }
  }

  override removePlayerEventListener(type: string, listener: any, options?: any) {
    if (!this.player) {
      console.log(`W3cMediaApp::hlsjsplayer: removePlayerEventListener, called when not initialized`);
      return;
    }

    switch (type) {
      case "debug":
           this.player.off(HlsPlayerLib.Events.MANIFEST_LOADED, listener);
           this.player.off(HlsPlayerLib.Events.MANIFEST_PARSED, listener);
           this.player.off(HlsPlayerLib.Events.MANIFEST_PARSED, listener);
           this.player.off(HlsPlayerLib.Events.MEDIA_ATTACHED, listener);
           this.player.off(HlsPlayerLib.Events.BUFFER_CREATED, listener);
           this.player.off(HlsPlayerLib.Events.BUFFER_APPENDED, listener);
           this.player.off(HlsPlayerLib.Events.MANIFEST_LOADED, listener);
           this.player.off(HlsPlayerLib.Events.MEDIA_DETACHED, listener);
           this.player.off(HlsPlayerLib.Events.DESTROYING, listener);
           break;
      default:
           if (HlsEventsMap.has(type)) {
             this.player.off(HlsEventsMap.get(type), listener);
           } else {
             console.log(`W3cMediaApp::hlsjsplayer:${type} Mapping is not available`);
           }
           break;
    }
  }
}
