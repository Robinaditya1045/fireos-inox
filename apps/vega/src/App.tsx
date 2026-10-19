import React, {useCallback, useEffect, useState} from 'react';
import type {Room, Session} from '../../../packages/core/src';
import {config} from './platform/config';
import {logger} from './platform/logger';
import {auth} from './platform/services';
import {saveLastRoomId} from './platform/storage';
import {BootScreen, SESSION_ENDED, type BootResult} from './screens/BootScreen';
import {LobbyScreen} from './screens/LobbyScreen';
import {RoomScreen} from './screens/RoomScreen';
import {SignInScreen} from './screens/SignInScreen';

// The player bench is required only inside a __DEV__ branch, so release bundles don't contain it
// (same pattern as the dev credentials in platform/config.ts).
const PlayerLab = __DEV__ ? (require('./dev/PlayerLab') as typeof import('./dev/PlayerLab')).PlayerLab : null;

type Screen = {name: 'boot'} | {name: 'signin'; notice?: string} | {name: 'lobby'} | {name: 'room'; room: Room};

export const App = () => (config.playerLab && PlayerLab ? <PlayerLab {...config.playerLab} /> : <WatchParty />);

const WatchParty = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<Screen>({name: 'boot'});
  /** The room entered last, this run or a previous one: the lobby focuses it first. */
  const [lastRoomId, setLastRoomId] = useState<string | null>(null);

  useEffect(
    () =>
      auth.onSignedOut((reason) => {
        logger.info('auth', reason === 'expired' ? 'session ended' : 'signed out');
        setSession(null);
        setScreen({name: 'signin', notice: reason === 'expired' ? SESSION_ENDED : undefined});
      }),
    [],
  );

  useEffect(() => {
    logger.info('nav', 'screen', {name: screen.name});
  }, [screen.name]);

  const booted = useCallback((result: BootResult) => {
    setLastRoomId(result.lastRoomId);
    setSession(result.session);
    setScreen(result.session ? {name: 'lobby'} : {name: 'signin', notice: result.notice});
  }, []);

  const signedIn = useCallback((s: Session) => {
    auth.set(s);
    setSession(s);
    setScreen({name: 'lobby'});
  }, []);

  const enterRoom = useCallback((room: Room) => {
    setLastRoomId(room.id);
    saveLastRoomId(room.id);
    setScreen({name: 'room', room});
  }, []);

  const leaveRoom = useCallback(() => setScreen({name: 'lobby'}), []);

  if (screen.name === 'boot') return <BootScreen onDone={booted} />;
  if (!session || screen.name === 'signin') {
    return <SignInScreen notice={screen.name === 'signin' ? screen.notice : undefined} onSignedIn={signedIn} />;
  }
  if (screen.name === 'room') return <RoomScreen room={screen.room} session={session} onLeave={leaveRoom} />;
  return <LobbyScreen username={session.username} focusRoomId={lastRoomId} onEnterRoom={enterRoom} />;
};
