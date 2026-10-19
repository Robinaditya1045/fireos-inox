import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ApiError, type Session} from '../../../../packages/core/src';
import {useExitPrompt} from '../components/ExitPrompt';
import {FocusButton} from '../components/FocusButton';
import {InlineNotice} from '../components/InlineNotice';
import {TextField} from '../components/TextField';
import {UrlKeyboard} from '../components/UrlKeyboard';
import {useFocusTarget} from '../components/useFocusTarget';
import {Wordmark} from '../components/Wordmark';
import {config} from '../platform/config';
import {logger} from '../platform/logger';
import {api} from '../platform/services';
import {color, font, radius, size, space} from '../theme/tokens';

type Field = 'email' | 'password';
type FocusId = Field | 'submit';
type Message = {tone: 'info' | 'danger'; text: string};

const EMAIL_SNIPPETS = ['@', '.com', '@gmail.com', '.test'];
const VALUE_LINES = ['Your Inox rooms, on the big screen', 'Playback in sync with everyone watching', 'Made for the remote'];

function errorText(status: number): string {
  if (status === 401) return 'Wrong email or password';
  if (status === 429) return 'Too many attempts — wait a minute';
  if (status === 0) return "Can't reach Inox";
  return 'Sign-in failed';
}

/**
 * Brand on the left, sign-in card on the right. The fields open an app-drawn keyboard (R18); dev
 * builds prefill the seeded TV user and start on "Sign in". Back closes the keyboard, otherwise
 * asks "Leave Inox?".
 */
export const SignInScreen = ({onSignedIn, notice}: {onSignedIn: (s: Session) => void; notice?: string}) => {
  const [email, setEmail] = useState(config.devEmail);
  const [password, setPassword] = useState(config.devPassword);
  const [editing, setEditing] = useState<Field | null>(null);
  const [message, setMessage] = useState<Message | null>(notice ? {tone: 'info', text: notice} : null);
  const [busy, setBusy] = useState(false);
  const prefilled = !!(config.devEmail && config.devPassword);
  const {target: focusId, request: requestFocus, settle: settleFocus} = useFocusTarget<FocusId>(prefilled ? 'submit' : 'email');
  const lastFocus = useRef<FocusId>(prefilled ? 'submit' : 'email');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const closeKeyboard = (focusOn: FocusId) => {
    setEditing(null);
    requestFocus(focusOn);
  };

  const exitPrompt = useExitPrompt({
    onBack: () => {
      if (!editing) return false;
      logger.info('signin', 'back closes the keyboard', {field: editing});
      closeKeyboard(editing);
      return true;
    },
    onClosed: () => requestFocus(lastFocus.current),
  });

  const focused = (id: FocusId) => () => {
    lastFocus.current = id;
    settleFocus();
  };

  const submit = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setMessage({tone: 'danger', text: 'Enter your email and password'});
      requestFocus(trimmed ? 'password' : 'email');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const session = await api.login(trimmed, password);
      logger.info('auth', 'signed in', {user: session.username});
      onSignedIn(session);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : -1;
      logger.warn('auth', 'sign-in failed', {status});
      if (!alive.current) return;
      setMessage({tone: 'danger', text: errorText(status)});
      setBusy(false);
    }
  };

  if (editing) {
    const isEmail = editing === 'email';
    return (
      <View style={styles.root}>
        <UrlKeyboard
          key={editing}
          compact
          value={isEmail ? email : password}
          onChange={isEmail ? setEmail : setPassword}
          onSubmit={() => {
            if (isEmail) {
              setEditing('password');
            } else {
              closeKeyboard('submit');
              submit();
            }
          }}
          snippets={isEmail ? EMAIL_SNIPPETS : []}
          placeholder={isEmail ? 'Email' : 'Password'}
          hint={isEmail ? 'Your Inox email. Back returns to the form.' : 'Your Inox password. Back returns to the form.'}
          fieldLabel={isEmail ? 'Email' : 'Password'}
          secure={!isEmail}
          shiftSymbols
          submitLabel={isEmail ? 'Next ›' : '✓ Sign in'}
        />
        {exitPrompt.dialog}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.columns}>
        <View style={styles.brand}>
          <Wordmark />
          <Text style={styles.tagline}>Watch together, from the couch.</Text>
          <View style={styles.values}>
            {VALUE_LINES.map((line) => (
              <View key={line} style={styles.valueRow}>
                <Text style={styles.valueIcon}>✓</Text>
                <Text style={styles.valueText}>{line}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.card}>
          <TextField
            testID="signin-email"
            label="Email"
            value={email}
            placeholder="Select to type"
            preferred={focusId === 'email'}
            onFocus={focused('email')}
            onPress={() => setEditing('email')}
          />
          <TextField
            testID="signin-password"
            label="Password"
            value={password}
            placeholder="Select to type"
            secure
            preferred={focusId === 'password'}
            onFocus={focused('password')}
            onPress={() => setEditing('password')}
          />
          <FocusButton
            testID="sign-in"
            label={busy ? 'Signing in…' : 'Sign in'}
            variant="primary"
            onPress={submit}
            hasTVPreferredFocus={focusId === 'submit'}
            onFocus={focused('submit')}
            style={styles.button}
          />
          {message ? <InlineNotice tone={message.tone} text={message.text} /> : null}
        </View>
      </View>
      {exitPrompt.dialog}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: color.bg, paddingHorizontal: space.safeX, paddingVertical: space.safeY, justifyContent: 'center'},
  columns: {flexDirection: 'row', alignItems: 'center', gap: space.xxl},
  brand: {flex: 1, gap: space.lg},
  tagline: {color: color.text, fontSize: font.heading, fontWeight: '600'},
  values: {gap: space.xs},
  valueRow: {flexDirection: 'row', gap: space.sm},
  valueIcon: {color: color.success, fontSize: font.caption, fontWeight: '700'},
  valueText: {color: color.textMuted, fontSize: font.caption, flexShrink: 1},
  card: {flex: 1, maxWidth: size.formMaxWidth, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md},
  button: {alignItems: 'center'},
});
