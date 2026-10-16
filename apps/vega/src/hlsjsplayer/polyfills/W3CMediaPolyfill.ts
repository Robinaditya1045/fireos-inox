/*
 * Copyright 2022-2026 Amazon.com, Inc. or its affiliates. All rights reserved.
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
//
import {
  requestMediaKeySystemAccess,
  MediaSource,
  HTMLMediaElement,
  DOMException,
  VTTCue,
  MediaError
} from '@amazon-devices/react-native-w3cmedia/dist/headless';

class W3CMediaPolyfill {
  static install() {
    console.log('Installing W3CMedia polyfills');
    global.window.MediaSource = global.MediaSource = MediaSource;
    global.navigator.requestMediaKeySystemAccess = window.navigator.requestMediaKeySystemAccess = requestMediaKeySystemAccess;
    global.HTMLMediaElement = HTMLMediaElement;
    global.HTMLVideoElement = HTMLMediaElement;
    global.DOMException = DOMException;
    window.self.VTTCue = self.VTTCue = VTTCue;
    global.self.location = {
      href: '',
    };
    global.window.MediaError = global.MediaError = MediaError;
  }
}

export default W3CMediaPolyfill;
