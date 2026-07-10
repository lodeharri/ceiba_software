<script setup lang="ts">
/**
 * LoginPage — POST to /auth/login, redirect to /productos on success.
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import Input from '@/components/atoms/Input.vue';
import Button from '@/components/atoms/Button.vue';
import { useAuthStore } from '@/stores/auth';
import { login } from '@/services/auth';

const router = useRouter();
const auth = useAuthStore();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function handleLogin() {
  if (!username.value || !password.value) {
    error.value = 'Completa todos los campos.';
    return;
  }
  error.value = '';
  loading.value = true;
  try {
    const res = await login({ username: username.value, password: password.value });
    auth.login({
      token: res.token,
      expiresAt: res.expiresAt,
      user: { id: res.user.id, username: res.user.username, role: res.user.role as 'ADMIN' },
    });
    router.push('/productos');
  } catch {
    // backend returns structured error; login error is known
    error.value = 'Credenciales inválidas. Verifica tu usuario y contraseña.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold text-text mb-6 text-center">{{ $t('auth.title') }}</h2>

    <form class="flex flex-col gap-4" @submit.prevent="handleLogin">
      <Input
        id="login-username"
        v-model="username"
        :label="$t('auth.username')"
        type="text"
        autocomplete="username"
        required
      />
      <Input
        id="login-password"
        v-model="password"
        :label="$t('auth.password')"
        type="password"
        autocomplete="current-password"
        required
      />

      <p v-if="error" class="text-sm text-danger text-center" role="alert">
        {{ error }}
      </p>

      <Button type="submit" :loading="loading" class="w-full mt-2">
        {{ $t('auth.loginButton') }}
      </Button>
    </form>
  </div>
</template>
