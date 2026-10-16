import React, {useEffect, useState} from 'react';
import type {Room, Session} from '../../../packages/core/src';
import {logger} from './platform/logger';
import {auth} from './platform/services';
import {LobbyScreen} from './screens/LobbyScreen';
import {RoomScreen} from './screens/RoomScreen';
import {SignInScreen} from './screens/SignInScreen';

type Screen = {name: 'signin'; notice?: string} | {name: 'lobby'} | {name: 'room'; room: Room};

export const App = () => {
  const [session, setSession] = useState<Session | null>(auth.get());
  const [screen, setScreen] = useState<Screen>({name: 'signin'});

  useEffect(() => {
    auth.onSignedOut(() => {
      logger.warn('auth', 'session ended');
      setSession(null);
      setScreen({name: 'signin', notice: 'Your session ended — please sign in again'});
    });
  }, []);

  useEffect(() => {
    logger.info('nav', 'screen', {name: !session ? 'signin' : screen.name});
  }, [screen, session]);

  if (!session || screen.name === 'signin') {
    return (
      <SignInScreen
        notice={screen.name === 'signin' ? screen.notice : undefined}
        onSignedIn={(s) => {
          auth.set(s);
          setSession(s);
          setScreen({name: 'lobby'});
        }}
      />
    );
  }
  if (screen.name === 'room') {
    return <RoomScreen room={screen.room} session={session} onLeave={() => setScreen({name: 'lobby'})} />;
  }
  return <LobbyScreen username={session.username} onEnterRoom={(room) => setScreen({name: 'room', room})} />;
};
