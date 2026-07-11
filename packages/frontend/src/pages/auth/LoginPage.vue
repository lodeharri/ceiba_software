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
      user: { id: res.user.id, username: res.user.username, role: res.user.role },
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
    <!-- Brand header: a thesis on first sight. Per frontend-design,
         open with the most characteristic thing: the brand and a tagline
         that says what this product is FOR. MercadoExpress is a small
         Colombian retail inventory operator's tool — not a SaaS. -->
    <div class="text-center mb-8">
      <div
        class="inline-flex items-center justify-center w-14 h-14 rounded-card bg-primary text-card font-bold text-xl mb-3"
        aria-hidden="true"
      >
        M
      </div>
      <h1 class="text-xl font-semibold text-text">MercadoExpress</h1>
      <p class="text-sm text-text-muted mt-1">{{ $t('auth.tagline') }}</p>
    </div>

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
