import React, {useEffect, useState} from 'react';
import {Keyboard, StyleSheet, Text, TextInput, View} from 'react-native';
import {ApiError, type Session} from '../../../../packages/core/src';
import {FocusButton} from '../components/FocusButton';
import {config} from '../platform/config';
import {logger} from '../platform/logger';
import {api} from '../platform/services';
import {color, focus, font, radius, space} from '../theme/tokens';

export const SignInScreen = ({onSignedIn, notice}: {onSignedIn: (s: Session) => void; notice?: string}) => {
  const [email, setEmail] = useState(config.devEmail);
  const [password, setPassword] = useState(config.devPassword);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'email' | 'password' | null>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => logger.debug('focus', 'keyboard shown'));
    const hide = Keyboard.addListener('keyboardDidHide', () => logger.debug('focus', 'keyboard hidden'));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(email.trim(), password);
      logger.info('auth', 'signed in', {user: session.username});
      onSignedIn(session);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : -1;
      logger.warn('auth', 'sign-in failed', {status});
      setError(
        status === 401
          ? 'Wrong email or password'
          : status === 429
            ? 'Too many attempts — wait a minute'
            : status === 0
              ? "Can't reach Inox"
              : 'Sign-in failed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Inox</Text>
      <Text style={styles.subtitle}>Watch together, from the couch.</Text>
      <TextInput
        style={[styles.input, focusedInput === 'email' && styles.inputFocused]}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={color.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        accessibilityLabel="Email"
        onFocus={() => {
          setFocusedInput('email');
          logger.debug('focus', 'input', {id: 'email'});
        }}
        onBlur={() => {
          setFocusedInput(null);
          logger.debug('focus', 'input blur', {id: 'email'});
        }}
        onSubmitEditing={() => logger.debug('focus', 'input submit', {id: 'email'})}
      />
      <TextInput
        style={[styles.input, focusedInput === 'password' && styles.inputFocused]}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={color.textMuted}
        secureTextEntry
        accessibilityLabel="Password"
        onFocus={() => {
          setFocusedInput('password');
          logger.debug('focus', 'input', {id: 'password'});
        }}
        onBlur={() => setFocusedInput(null)}
      />
      <FocusButton
        testID="sign-in"
        label={busy ? 'Signing in…' : 'Sign in'}
        onPress={submit}
        hasTVPreferredFocus
        style={styles.button}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: color.bg, paddingHorizontal: space.safeX, paddingVertical: space.safeY, justifyContent: 'center'},
  title: {color: color.text, fontSize: font.display, fontWeight: '700'},
  subtitle: {color: color.textMuted, fontSize: font.body, marginBottom: space.xxl},
  input: {
    width: 640,
    color: color.text,
    fontSize: font.body,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.lg,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  inputFocused: {borderColor: color.accent, backgroundColor: color.surfaceRaised},
  button: {width: 640, alignItems: 'center'},
  error: {color: color.danger, fontSize: font.body, marginTop: space.lg},
});
