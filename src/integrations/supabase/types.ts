export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_oauth_start_states: {
        Row: {
          admin_user_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          state_hash: string;
          used_at: string | null;
        };
        Insert: {
          admin_user_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          state_hash: string;
          used_at?: string | null;
        };
        Update: {
          admin_user_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          state_hash?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      agent_api_keys: {
        Row: {
          agent_profile_id: string;
          allowed_ips: string[] | null;
          created_at: string;
          daily_request_limit: number | null;
          daily_tx_limit: number | null;
          expires_at: string | null;
          hmac_secret_hash: string;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          max_buy_eth: number | null;
          max_buy_sol: number | null;
          max_launch_initial_buy_eth: number | null;
          max_launch_initial_buy_sol: number | null;
          max_liquidity_eth: number | null;
          max_sell_percent: number | null;
          max_transfer_eth: number | null;
          max_transfer_sol: number | null;
          metadata: Json;
          name: string;
          pepper_version: string;
          require_hmac: boolean;
          revoked_at: string | null;
          scopes: string[];
          status: string;
          user_id: string;
          wallet_id: string | null;
        };
        Insert: {
          agent_profile_id: string;
          allowed_ips?: string[] | null;
          created_at?: string;
          daily_request_limit?: number | null;
          daily_tx_limit?: number | null;
          expires_at?: string | null;
          hmac_secret_hash: string;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          max_buy_eth?: number | null;
          max_buy_sol?: number | null;
          max_launch_initial_buy_eth?: number | null;
          max_launch_initial_buy_sol?: number | null;
          max_liquidity_eth?: number | null;
          max_sell_percent?: number | null;
          max_transfer_eth?: number | null;
          max_transfer_sol?: number | null;
          metadata?: Json;
          name: string;
          pepper_version?: string;
          require_hmac?: boolean;
          revoked_at?: string | null;
          scopes?: string[];
          status?: string;
          user_id: string;
          wallet_id?: string | null;
        };
        Update: {
          agent_profile_id?: string;
          allowed_ips?: string[] | null;
          created_at?: string;
          daily_request_limit?: number | null;
          daily_tx_limit?: number | null;
          expires_at?: string | null;
          hmac_secret_hash?: string;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          max_buy_eth?: number | null;
          max_buy_sol?: number | null;
          max_launch_initial_buy_eth?: number | null;
          max_launch_initial_buy_sol?: number | null;
          max_liquidity_eth?: number | null;
          max_sell_percent?: number | null;
          max_transfer_eth?: number | null;
          max_transfer_sol?: number | null;
          metadata?: Json;
          name?: string;
          pepper_version?: string;
          require_hmac?: boolean;
          revoked_at?: string | null;
          scopes?: string[];
          status?: string;
          user_id?: string;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_api_keys_agent_profile_id_fkey";
            columns: ["agent_profile_id"];
            isOneToOne: false;
            referencedRelation: "agent_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_api_keys_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_api_nonces: {
        Row: {
          api_key_id: string;
          created_at: string;
          id: string;
          nonce: string;
          timestamp_at: string;
        };
        Insert: {
          api_key_id: string;
          created_at?: string;
          id?: string;
          nonce: string;
          timestamp_at: string;
        };
        Update: {
          api_key_id?: string;
          created_at?: string;
          id?: string;
          nonce?: string;
          timestamp_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_api_nonces_api_key_id_fkey";
            columns: ["api_key_id"];
            isOneToOne: false;
            referencedRelation: "agent_api_keys";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_api_requests: {
        Row: {
          agent_profile_id: string | null;
          api_key_id: string | null;
          created_at: string;
          duration_ms: number | null;
          error_code: string | null;
          error_message: string | null;
          id: string;
          idempotency_key: string | null;
          ip: string | null;
          method: string;
          nonce: string | null;
          path: string;
          request_hash: string | null;
          response_hash: string | null;
          status_code: number | null;
          user_agent: string | null;
          user_id: string | null;
          wallet_id: string | null;
        };
        Insert: {
          agent_profile_id?: string | null;
          api_key_id?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          idempotency_key?: string | null;
          ip?: string | null;
          method: string;
          nonce?: string | null;
          path: string;
          request_hash?: string | null;
          response_hash?: string | null;
          status_code?: number | null;
          user_agent?: string | null;
          user_id?: string | null;
          wallet_id?: string | null;
        };
        Update: {
          agent_profile_id?: string | null;
          api_key_id?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          idempotency_key?: string | null;
          ip?: string | null;
          method?: string;
          nonce?: string | null;
          path?: string;
          request_hash?: string | null;
          response_hash?: string | null;
          status_code?: number | null;
          user_agent?: string | null;
          user_id?: string | null;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_api_requests_agent_profile_id_fkey";
            columns: ["agent_profile_id"];
            isOneToOne: false;
            referencedRelation: "agent_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_api_requests_api_key_id_fkey";
            columns: ["api_key_id"];
            isOneToOne: false;
            referencedRelation: "agent_api_keys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_api_requests_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_onboarding_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          metadata: Json;
          pepper_version: string;
          requested_scopes: string[];
          status: string;
          token_hash: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          metadata?: Json;
          pepper_version?: string;
          requested_scopes?: string[];
          status?: string;
          token_hash: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          metadata?: Json;
          pepper_version?: string;
          requested_scopes?: string[];
          status?: string;
          token_hash?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      agent_profiles: {
        Row: {
          agent_type: string;
          allowed_callback_urls: string[] | null;
          created_at: string;
          disabled_at: string | null;
          id: string;
          metadata: Json;
          name: string;
          public_contact: string | null;
          status: string;
          terms_accepted_at: string | null;
          updated_at: string;
          user_id: string;
          wallet_id: string | null;
        };
        Insert: {
          agent_type?: string;
          allowed_callback_urls?: string[] | null;
          created_at?: string;
          disabled_at?: string | null;
          id?: string;
          metadata?: Json;
          name: string;
          public_contact?: string | null;
          status?: string;
          terms_accepted_at?: string | null;
          updated_at?: string;
          user_id: string;
          wallet_id?: string | null;
        };
        Update: {
          agent_type?: string;
          allowed_callback_urls?: string[] | null;
          created_at?: string;
          disabled_at?: string | null;
          id?: string;
          metadata?: Json;
          name?: string;
          public_contact?: string | null;
          status?: string;
          terms_accepted_at?: string | null;
          updated_at?: string;
          user_id?: string;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_profiles_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_runs: {
        Row: {
          chain: string | null;
          classification: Json | null;
          completed_at: string | null;
          confidence: number | null;
          created_at: string;
          error: string | null;
          extraction: Json | null;
          id: string;
          idempotency_key: string | null;
          intent: string | null;
          outcome: Json | null;
          prompt_slots: Json | null;
          prompt_version: string | null;
          reply_lint_result: Json | null;
          reply_mode: string | null;
          reply_plan: Json | null;
          requires_confirmation: boolean;
          retrieval_request: Json | null;
          retrieval_summary: string | null;
          retrieved_history: Json | null;
          route_decision: Json | null;
          route_resources: Json | null;
          source_surface: string;
          status: string;
          terminal_conversation_id: string | null;
          terminal_message_id: string | null;
          thread_context: Json | null;
          tool_results: Json | null;
          tweet_id: string | null;
          user_context: Json | null;
          user_id: string | null;
          working_frame: Json | null;
        };
        Insert: {
          chain?: string | null;
          classification?: Json | null;
          completed_at?: string | null;
          confidence?: number | null;
          created_at?: string;
          error?: string | null;
          extraction?: Json | null;
          id?: string;
          idempotency_key?: string | null;
          intent?: string | null;
          outcome?: Json | null;
          prompt_slots?: Json | null;
          prompt_version?: string | null;
          reply_lint_result?: Json | null;
          reply_mode?: string | null;
          reply_plan?: Json | null;
          requires_confirmation?: boolean;
          retrieval_request?: Json | null;
          retrieval_summary?: string | null;
          retrieved_history?: Json | null;
          route_decision?: Json | null;
          route_resources?: Json | null;
          source_surface?: string;
          status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          thread_context?: Json | null;
          tool_results?: Json | null;
          tweet_id?: string | null;
          user_context?: Json | null;
          user_id?: string | null;
          working_frame?: Json | null;
        };
        Update: {
          chain?: string | null;
          classification?: Json | null;
          completed_at?: string | null;
          confidence?: number | null;
          created_at?: string;
          error?: string | null;
          extraction?: Json | null;
          id?: string;
          idempotency_key?: string | null;
          intent?: string | null;
          outcome?: Json | null;
          prompt_slots?: Json | null;
          prompt_version?: string | null;
          reply_lint_result?: Json | null;
          reply_mode?: string | null;
          reply_plan?: Json | null;
          requires_confirmation?: boolean;
          retrieval_request?: Json | null;
          retrieval_summary?: string | null;
          retrieved_history?: Json | null;
          route_decision?: Json | null;
          route_resources?: Json | null;
          source_surface?: string;
          status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          thread_context?: Json | null;
          tool_results?: Json | null;
          tweet_id?: string | null;
          user_context?: Json | null;
          user_id?: string | null;
          working_frame?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_tweet_id_fkey";
            columns: ["tweet_id"];
            isOneToOne: false;
            referencedRelation: "tweets_inbox";
            referencedColumns: ["tweet_id"];
          },
        ];
      };
      agent_runs_archive: {
        Row: {
          archived_at: string;
          classification: Json | null;
          completed_at: string | null;
          confidence: number | null;
          created_at: string;
          error: string | null;
          extraction: Json | null;
          id: string;
          idempotency_key: string | null;
          intent: string | null;
          outcome: Json | null;
          prompt_slots: Json | null;
          prompt_version: string | null;
          reply_lint_result: Json | null;
          reply_mode: string | null;
          reply_plan: Json | null;
          requires_confirmation: boolean;
          retrieval_request: Json | null;
          retrieval_summary: string | null;
          retrieved_history: Json | null;
          route_decision: Json | null;
          route_resources: Json | null;
          source_surface: string | null;
          status: string;
          terminal_conversation_id: string | null;
          terminal_message_id: string | null;
          thread_context: Json | null;
          tool_results: Json | null;
          tweet_id: string | null;
          user_context: Json | null;
          user_id: string | null;
          working_frame: Json | null;
        };
        Insert: {
          archived_at?: string;
          classification?: Json | null;
          completed_at?: string | null;
          confidence?: number | null;
          created_at?: string;
          error?: string | null;
          extraction?: Json | null;
          id?: string;
          idempotency_key?: string | null;
          intent?: string | null;
          outcome?: Json | null;
          prompt_slots?: Json | null;
          prompt_version?: string | null;
          reply_lint_result?: Json | null;
          reply_mode?: string | null;
          reply_plan?: Json | null;
          requires_confirmation?: boolean;
          retrieval_request?: Json | null;
          retrieval_summary?: string | null;
          retrieved_history?: Json | null;
          route_decision?: Json | null;
          route_resources?: Json | null;
          source_surface?: string | null;
          status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          thread_context?: Json | null;
          tool_results?: Json | null;
          tweet_id?: string | null;
          user_context?: Json | null;
          user_id?: string | null;
          working_frame?: Json | null;
        };
        Update: {
          archived_at?: string;
          classification?: Json | null;
          completed_at?: string | null;
          confidence?: number | null;
          created_at?: string;
          error?: string | null;
          extraction?: Json | null;
          id?: string;
          idempotency_key?: string | null;
          intent?: string | null;
          outcome?: Json | null;
          prompt_slots?: Json | null;
          prompt_version?: string | null;
          reply_lint_result?: Json | null;
          reply_mode?: string | null;
          reply_plan?: Json | null;
          requires_confirmation?: boolean;
          retrieval_request?: Json | null;
          retrieval_summary?: string | null;
          retrieved_history?: Json | null;
          route_decision?: Json | null;
          route_resources?: Json | null;
          source_surface?: string | null;
          status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          thread_context?: Json | null;
          tool_results?: Json | null;
          tweet_id?: string | null;
          user_context?: Json | null;
          user_id?: string | null;
          working_frame?: Json | null;
        };
        Relationships: [];
      };
      app_state: {
        Row: {
          key: string;
          updated_at: string;
          value: Json | null;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value?: Json | null;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json | null;
        };
        Relationships: [];
      };
      auth_handoff_codes: {
        Row: {
          access_token_ciphertext: string;
          access_token_iv: string;
          code_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          redirect_to: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          access_token_ciphertext: string;
          access_token_iv: string;
          code_hash: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          redirect_to: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          access_token_ciphertext?: string;
          access_token_iv?: string;
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          redirect_to?: string;
          refresh_token_ciphertext?: string;
          refresh_token_iv?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      banned_x_users: {
        Row: {
          banned_at: string;
          banned_by_user_id: string | null;
          display_name_at_ban: string | null;
          id: string;
          is_active: boolean;
          profile_image_url: string | null;
          reason: string | null;
          unbanned_at: string | null;
          unbanned_by_user_id: string | null;
          updated_at: string;
          username_at_ban: string | null;
          x_user_id: string;
        };
        Insert: {
          banned_at?: string;
          banned_by_user_id?: string | null;
          display_name_at_ban?: string | null;
          id?: string;
          is_active?: boolean;
          profile_image_url?: string | null;
          reason?: string | null;
          unbanned_at?: string | null;
          unbanned_by_user_id?: string | null;
          updated_at?: string;
          username_at_ban?: string | null;
          x_user_id: string;
        };
        Update: {
          banned_at?: string;
          banned_by_user_id?: string | null;
          display_name_at_ban?: string | null;
          id?: string;
          is_active?: boolean;
          profile_image_url?: string | null;
          reason?: string | null;
          unbanned_at?: string | null;
          unbanned_by_user_id?: string | null;
          updated_at?: string;
          username_at_ban?: string | null;
          x_user_id?: string;
        };
        Relationships: [];
      };
      coin_comment_likes: {
        Row: {
          comment_id: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coin_comment_likes_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "coin_comments";
            referencedColumns: ["id"];
          },
        ];
      };
      coin_comments: {
        Row: {
          body: string;
          chain: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          like_count: number;
          mint: string;
          parent_id: string | null;
          reply_count: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          chain?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          like_count?: number;
          mint: string;
          parent_id?: string | null;
          reply_count?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          chain?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          like_count?: number;
          mint?: string;
          parent_id?: string | null;
          reply_count?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coin_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "coin_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coin_comments_user_id_fkey_profile";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      coin_launch_retired_reward_archive: {
        Row: {
          archived_at: string;
          coin_launch_id: string;
          retired_config: Json;
        };
        Insert: {
          archived_at?: string;
          coin_launch_id: string;
          retired_config?: Json;
        };
        Update: {
          archived_at?: string;
          coin_launch_id?: string;
          retired_config?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "coin_launch_retired_reward_archive_coin_launch_id_fkey";
            columns: ["coin_launch_id"];
            isOneToOne: true;
            referencedRelation: "coin_launches";
            referencedColumns: ["id"];
          },
        ];
      };
      coin_launch_reward_recipients: {
        Row: {
          created_at: string;
          id: string;
          launch_id: string;
          role: string;
          share_bps: number;
          source: string;
          twitter_id: string | null;
          twitter_username: string | null;
          updated_at: string;
          user_id: string;
          wallet_address: string;
          wallet_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          launch_id: string;
          role?: string;
          share_bps: number;
          source: string;
          twitter_id?: string | null;
          twitter_username?: string | null;
          updated_at?: string;
          user_id: string;
          wallet_address: string;
          wallet_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          launch_id?: string;
          role?: string;
          share_bps?: number;
          source?: string;
          twitter_id?: string | null;
          twitter_username?: string | null;
          updated_at?: string;
          user_id?: string;
          wallet_address?: string;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coin_launch_reward_recipients_launch_id_fkey";
            columns: ["launch_id"];
            isOneToOne: false;
            referencedRelation: "coin_launches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coin_launch_reward_recipients_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      coin_launches: {
        Row: {
          action_ordinal: number;
          attempt_count: number;
          chain: string | null;
          chain_id: number | null;
          created_at: string;
          creator_rewards_config: Json | null;
          deployer: string | null;
          description: string | null;
          dev_buy_eth: number | null;
          dev_buy_original_amount: number | null;
          dev_buy_original_unit: string | null;
          dev_buy_sol: number | null;
          dev_buy_usd: number | null;
          dex_factory: string | null;
          effective_initial_buy_eth: number | null;
          effective_initial_buy_lamports: string | null;
          effective_initial_buy_wei: string | null;
          error: string | null;
          eth_price_usd: number | null;
          explorer_url: string | null;
          factory: string | null;
          fee_recipient_kind: string | null;
          fee_recipient_twitter_username: string | null;
          fee_wallet: string | null;
          fee_wallet_user_id: string | null;
          filebase_image_object_key: string | null;
          filebase_metadata_object_key: string | null;
          first_launch_subsidized: boolean;
          first_launch_subsidy_eligible: boolean;
          funding_amount_wei: string | null;
          funding_error: string | null;
          funding_policy: string | null;
          funding_status: string | null;
          funding_tx_hash: string | null;
          graduation_weth_wei: string | null;
          id: string;
          idempotency_key: string | null;
          image_url: string | null;
          initial_buy_amount_wei: string | null;
          initial_buy_policy: string | null;
          initial_buy_tokens_out_wei: string | null;
          ipfs_image_cid: string | null;
          ipfs_image_gateway_url: string | null;
          ipfs_image_uri: string | null;
          ipfs_metadata_cid: string | null;
          ipfs_metadata_gateway_url: string | null;
          ipfs_metadata_uri: string | null;
          is_token0: boolean | null;
          last_attempt_at: string | null;
          launch_fee_wei: string | null;
          launch_metadata: Json | null;
          launch_method: string | null;
          launch_origin: string | null;
          launch_platform: string | null;
          launch_signer_address: string | null;
          launch_signer_wallet_id: string | null;
          launch_source: string;
          lp_dust_wei: string | null;
          lp_liquidity: string | null;
          lp_sqrt_price_x96: string | null;
          lp_tick_lower: string | null;
          lp_tick_upper: string | null;
          lp_used_launch_wei: string | null;
          max_attempts: number;
          mayhem_mode_requested: boolean | null;
          metadata_storage_error: string | null;
          metadata_storage_provider: string | null;
          metadata_telegram_url: string | null;
          metadata_twitter_url: string | null;
          metadata_uri: string | null;
          metadata_website_url: string | null;
          mint: string | null;
          name: string;
          next_attempt_at: string | null;
          noxa_receipt: Json | null;
          noxa_verified: Json | null;
          original_image_url: string | null;
          pair_token: string | null;
          paired_token: string | null;
          pool: string | null;
          pool_fee: number | null;
          position_id: string | null;
          position_manager: string | null;
          processed_at: string | null;
          processing_started_at: string | null;
          pump_metadata_uri: string | null;
          pump_receipt: Json | null;
          pump_url: string | null;
          requested_initial_buy_eth: number | null;
          requested_initial_buy_lamports: string | null;
          requested_initial_buy_wei: string | null;
          restrictions_end_block: string | null;
          single_sided_launch_receipt: Json | null;
          single_sided_launch_record: Json | null;
          sol_price_usd: number | null;
          solana_launch_wallet_address: string | null;
          solana_launch_wallet_id: string | null;
          solscan_url: string | null;
          source_surface: string;
          source_tweet_id: string | null;
          source_tweet_url: string | null;
          stable_logo_url: string | null;
          status: string;
          symbol: string;
          telegram_group_announced_at: string | null;
          telegram_group_announcement_attempted_at: string | null;
          telegram_group_announcement_chat_id: string | null;
          telegram_group_announcement_error: string | null;
          telegram_group_announcement_message_id: string | null;
          telegram_group_announcement_status: string;
          terminal_conversation_id: string | null;
          terminal_message_id: string | null;
          token_address: string | null;
          token_logo_storage_path: string | null;
          token_metadata_hash: string | null;
          token_metadata_storage_path: string | null;
          total_msg_value_wei: string | null;
          tweet_id: string | null;
          tx_hash: string | null;
          tx_signature: string | null;
          user_id: string | null;
          work_item_id: string | null;
          worker_id: string | null;
        };
        Insert: {
          action_ordinal?: number;
          attempt_count?: number;
          chain?: string | null;
          chain_id?: number | null;
          created_at?: string;
          creator_rewards_config?: Json | null;
          deployer?: string | null;
          description?: string | null;
          dev_buy_eth?: number | null;
          dev_buy_original_amount?: number | null;
          dev_buy_original_unit?: string | null;
          dev_buy_sol?: number | null;
          dev_buy_usd?: number | null;
          dex_factory?: string | null;
          effective_initial_buy_eth?: number | null;
          effective_initial_buy_lamports?: string | null;
          effective_initial_buy_wei?: string | null;
          error?: string | null;
          eth_price_usd?: number | null;
          explorer_url?: string | null;
          factory?: string | null;
          fee_recipient_kind?: string | null;
          fee_recipient_twitter_username?: string | null;
          fee_wallet?: string | null;
          fee_wallet_user_id?: string | null;
          filebase_image_object_key?: string | null;
          filebase_metadata_object_key?: string | null;
          first_launch_subsidized?: boolean;
          first_launch_subsidy_eligible?: boolean;
          funding_amount_wei?: string | null;
          funding_error?: string | null;
          funding_policy?: string | null;
          funding_status?: string | null;
          funding_tx_hash?: string | null;
          graduation_weth_wei?: string | null;
          id?: string;
          idempotency_key?: string | null;
          image_url?: string | null;
          initial_buy_amount_wei?: string | null;
          initial_buy_policy?: string | null;
          initial_buy_tokens_out_wei?: string | null;
          ipfs_image_cid?: string | null;
          ipfs_image_gateway_url?: string | null;
          ipfs_image_uri?: string | null;
          ipfs_metadata_cid?: string | null;
          ipfs_metadata_gateway_url?: string | null;
          ipfs_metadata_uri?: string | null;
          is_token0?: boolean | null;
          last_attempt_at?: string | null;
          launch_fee_wei?: string | null;
          launch_metadata?: Json | null;
          launch_method?: string | null;
          launch_origin?: string | null;
          launch_platform?: string | null;
          launch_signer_address?: string | null;
          launch_signer_wallet_id?: string | null;
          launch_source?: string;
          lp_dust_wei?: string | null;
          lp_liquidity?: string | null;
          lp_sqrt_price_x96?: string | null;
          lp_tick_lower?: string | null;
          lp_tick_upper?: string | null;
          lp_used_launch_wei?: string | null;
          max_attempts?: number;
          mayhem_mode_requested?: boolean | null;
          metadata_storage_error?: string | null;
          metadata_storage_provider?: string | null;
          metadata_telegram_url?: string | null;
          metadata_twitter_url?: string | null;
          metadata_uri?: string | null;
          metadata_website_url?: string | null;
          mint?: string | null;
          name: string;
          next_attempt_at?: string | null;
          noxa_receipt?: Json | null;
          noxa_verified?: Json | null;
          original_image_url?: string | null;
          pair_token?: string | null;
          paired_token?: string | null;
          pool?: string | null;
          pool_fee?: number | null;
          position_id?: string | null;
          position_manager?: string | null;
          processed_at?: string | null;
          processing_started_at?: string | null;
          pump_metadata_uri?: string | null;
          pump_receipt?: Json | null;
          pump_url?: string | null;
          requested_initial_buy_eth?: number | null;
          requested_initial_buy_lamports?: string | null;
          requested_initial_buy_wei?: string | null;
          restrictions_end_block?: string | null;
          single_sided_launch_receipt?: Json | null;
          single_sided_launch_record?: Json | null;
          sol_price_usd?: number | null;
          solana_launch_wallet_address?: string | null;
          solana_launch_wallet_id?: string | null;
          solscan_url?: string | null;
          source_surface?: string;
          source_tweet_id?: string | null;
          source_tweet_url?: string | null;
          stable_logo_url?: string | null;
          status?: string;
          symbol: string;
          telegram_group_announced_at?: string | null;
          telegram_group_announcement_attempted_at?: string | null;
          telegram_group_announcement_chat_id?: string | null;
          telegram_group_announcement_error?: string | null;
          telegram_group_announcement_message_id?: string | null;
          telegram_group_announcement_status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          token_address?: string | null;
          token_logo_storage_path?: string | null;
          token_metadata_hash?: string | null;
          token_metadata_storage_path?: string | null;
          total_msg_value_wei?: string | null;
          tweet_id?: string | null;
          tx_hash?: string | null;
          tx_signature?: string | null;
          user_id?: string | null;
          work_item_id?: string | null;
          worker_id?: string | null;
        };
        Update: {
          action_ordinal?: number;
          attempt_count?: number;
          chain?: string | null;
          chain_id?: number | null;
          created_at?: string;
          creator_rewards_config?: Json | null;
          deployer?: string | null;
          description?: string | null;
          dev_buy_eth?: number | null;
          dev_buy_original_amount?: number | null;
          dev_buy_original_unit?: string | null;
          dev_buy_sol?: number | null;
          dev_buy_usd?: number | null;
          dex_factory?: string | null;
          effective_initial_buy_eth?: number | null;
          effective_initial_buy_lamports?: string | null;
          effective_initial_buy_wei?: string | null;
          error?: string | null;
          eth_price_usd?: number | null;
          explorer_url?: string | null;
          factory?: string | null;
          fee_recipient_kind?: string | null;
          fee_recipient_twitter_username?: string | null;
          fee_wallet?: string | null;
          fee_wallet_user_id?: string | null;
          filebase_image_object_key?: string | null;
          filebase_metadata_object_key?: string | null;
          first_launch_subsidized?: boolean;
          first_launch_subsidy_eligible?: boolean;
          funding_amount_wei?: string | null;
          funding_error?: string | null;
          funding_policy?: string | null;
          funding_status?: string | null;
          funding_tx_hash?: string | null;
          graduation_weth_wei?: string | null;
          id?: string;
          idempotency_key?: string | null;
          image_url?: string | null;
          initial_buy_amount_wei?: string | null;
          initial_buy_policy?: string | null;
          initial_buy_tokens_out_wei?: string | null;
          ipfs_image_cid?: string | null;
          ipfs_image_gateway_url?: string | null;
          ipfs_image_uri?: string | null;
          ipfs_metadata_cid?: string | null;
          ipfs_metadata_gateway_url?: string | null;
          ipfs_metadata_uri?: string | null;
          is_token0?: boolean | null;
          last_attempt_at?: string | null;
          launch_fee_wei?: string | null;
          launch_metadata?: Json | null;
          launch_method?: string | null;
          launch_origin?: string | null;
          launch_platform?: string | null;
          launch_signer_address?: string | null;
          launch_signer_wallet_id?: string | null;
          launch_source?: string;
          lp_dust_wei?: string | null;
          lp_liquidity?: string | null;
          lp_sqrt_price_x96?: string | null;
          lp_tick_lower?: string | null;
          lp_tick_upper?: string | null;
          lp_used_launch_wei?: string | null;
          max_attempts?: number;
          mayhem_mode_requested?: boolean | null;
          metadata_storage_error?: string | null;
          metadata_storage_provider?: string | null;
          metadata_telegram_url?: string | null;
          metadata_twitter_url?: string | null;
          metadata_uri?: string | null;
          metadata_website_url?: string | null;
          mint?: string | null;
          name?: string;
          next_attempt_at?: string | null;
          noxa_receipt?: Json | null;
          noxa_verified?: Json | null;
          original_image_url?: string | null;
          pair_token?: string | null;
          paired_token?: string | null;
          pool?: string | null;
          pool_fee?: number | null;
          position_id?: string | null;
          position_manager?: string | null;
          processed_at?: string | null;
          processing_started_at?: string | null;
          pump_metadata_uri?: string | null;
          pump_receipt?: Json | null;
          pump_url?: string | null;
          requested_initial_buy_eth?: number | null;
          requested_initial_buy_lamports?: string | null;
          requested_initial_buy_wei?: string | null;
          restrictions_end_block?: string | null;
          single_sided_launch_receipt?: Json | null;
          single_sided_launch_record?: Json | null;
          sol_price_usd?: number | null;
          solana_launch_wallet_address?: string | null;
          solana_launch_wallet_id?: string | null;
          solscan_url?: string | null;
          source_surface?: string;
          source_tweet_id?: string | null;
          source_tweet_url?: string | null;
          stable_logo_url?: string | null;
          status?: string;
          symbol?: string;
          telegram_group_announced_at?: string | null;
          telegram_group_announcement_attempted_at?: string | null;
          telegram_group_announcement_chat_id?: string | null;
          telegram_group_announcement_error?: string | null;
          telegram_group_announcement_message_id?: string | null;
          telegram_group_announcement_status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          token_address?: string | null;
          token_logo_storage_path?: string | null;
          token_metadata_hash?: string | null;
          token_metadata_storage_path?: string | null;
          total_msg_value_wei?: string | null;
          tweet_id?: string | null;
          tx_hash?: string | null;
          tx_signature?: string | null;
          user_id?: string | null;
          work_item_id?: string | null;
          worker_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coin_launches_launch_signer_wallet_id_fkey";
            columns: ["launch_signer_wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coin_launches_solana_launch_wallet_id_fkey";
            columns: ["solana_launch_wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coin_launches_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      coin_settings_updates: {
        Row: {
          coin_launch_id: string | null;
          created_at: string;
          error: string | null;
          id: string;
          new_config: Json | null;
          previous_config: Json | null;
          status: string;
          tweet_id: string | null;
          tx_signature: string | null;
          user_id: string | null;
        };
        Insert: {
          coin_launch_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          new_config?: Json | null;
          previous_config?: Json | null;
          status?: string;
          tweet_id?: string | null;
          tx_signature?: string | null;
          user_id?: string | null;
        };
        Update: {
          coin_launch_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          new_config?: Json | null;
          previous_config?: Json | null;
          status?: string;
          tweet_id?: string | null;
          tx_signature?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coin_settings_updates_coin_launch_id_fkey";
            columns: ["coin_launch_id"];
            isOneToOne: false;
            referencedRelation: "coin_launches";
            referencedColumns: ["id"];
          },
        ];
      };
      cron_locks: {
        Row: {
          created_at: string;
          last_claimed_at: string;
          last_released_at: string | null;
          lock_name: string;
          locked_until: string;
          owner: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          last_claimed_at?: string;
          last_released_at?: string | null;
          lock_name: string;
          locked_until: string;
          owner: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          last_claimed_at?: string;
          last_released_at?: string | null;
          lock_name?: string;
          locked_until?: string;
          owner?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      home_metrics_cache: {
        Row: {
          build_status: string;
          cache_key: string;
          data: Json;
          error: string | null;
          expires_at: string;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          build_status?: string;
          cache_key: string;
          data: Json;
          error?: string | null;
          expires_at: string;
          generated_at?: string;
          updated_at?: string;
        };
        Update: {
          build_status?: string;
          cache_key?: string;
          data?: Json;
          error?: string | null;
          expires_at?: string;
          generated_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      linkr_action_drafts: {
        Row: {
          action_type: string;
          authorization_kind: string | null;
          auto_launch_authorized_at: string | null;
          closed_at: string | null;
          conversation_id: string | null;
          created_at: string;
          cron_job_id: string | null;
          draft_key: string;
          entity_refs: Json;
          expires_at: string;
          field_provenance: Json;
          filled_fields: Json;
          generation_context: Json;
          id: string;
          idempotency_key: string | null;
          last_input_work_item_id: string | null;
          last_message_id: string | null;
          last_user_input_at: string | null;
          privacy_label: string;
          required_fields: string[];
          session_generation: number;
          source_refs: Json;
          source_surface: string;
          source_tweet_id: string | null;
          status: string;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          updated_at: string;
          user_id: string;
          version: number;
          work_item_id: string | null;
          x_thread_id: string | null;
        };
        Insert: {
          action_type: string;
          authorization_kind?: string | null;
          auto_launch_authorized_at?: string | null;
          closed_at?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          draft_key: string;
          entity_refs?: Json;
          expires_at?: string;
          field_provenance?: Json;
          filled_fields?: Json;
          generation_context?: Json;
          id?: string;
          idempotency_key?: string | null;
          last_input_work_item_id?: string | null;
          last_message_id?: string | null;
          last_user_input_at?: string | null;
          privacy_label?: string;
          required_fields?: string[];
          session_generation?: number;
          source_refs?: Json;
          source_surface?: string;
          source_tweet_id?: string | null;
          status?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          user_id: string;
          version?: number;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Update: {
          action_type?: string;
          authorization_kind?: string | null;
          auto_launch_authorized_at?: string | null;
          closed_at?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          draft_key?: string;
          entity_refs?: Json;
          expires_at?: string;
          field_provenance?: Json;
          filled_fields?: Json;
          generation_context?: Json;
          id?: string;
          idempotency_key?: string | null;
          last_input_work_item_id?: string | null;
          last_message_id?: string | null;
          last_user_input_at?: string | null;
          privacy_label?: string;
          required_fields?: string[];
          session_generation?: number;
          source_refs?: Json;
          source_surface?: string;
          source_tweet_id?: string | null;
          status?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          user_id?: string;
          version?: number;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_action_drafts_last_input_work_item_id_fkey";
            columns: ["last_input_work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_drafts_last_message_id_fkey";
            columns: ["last_message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_drafts_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_drafts_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_action_jobs: {
        Row: {
          action_payload: Json;
          action_type: string;
          attempt_count: number;
          completed_at: string | null;
          created_at: string;
          cron_job_id: string | null;
          error_code: string | null;
          error_message: string | null;
          id: string;
          idempotency_key: string;
          pending_action_id: string | null;
          result: Json | null;
          run_id: string | null;
          source_surface: string;
          started_at: string | null;
          status: string;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          updated_at: string;
          user_id: string;
          work_item_id: string | null;
          x_thread_id: string | null;
        };
        Insert: {
          action_payload: Json;
          action_type: string;
          attempt_count?: number;
          completed_at?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          idempotency_key: string;
          pending_action_id?: string | null;
          result?: Json | null;
          run_id?: string | null;
          source_surface?: string;
          started_at?: string | null;
          status?: string;
          surface: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          user_id: string;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Update: {
          action_payload?: Json;
          action_type?: string;
          attempt_count?: number;
          completed_at?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          idempotency_key?: string;
          pending_action_id?: string | null;
          result?: Json | null;
          run_id?: string | null;
          source_surface?: string;
          started_at?: string | null;
          status?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          user_id?: string;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_action_jobs_pending_action_id_fkey";
            columns: ["pending_action_id"];
            isOneToOne: false;
            referencedRelation: "linkr_pending_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_jobs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "linkr_agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_jobs_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_jobs_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_action_receipts: {
        Row: {
          canonical_record_id: string | null;
          canonical_record_type: string | null;
          chain: string | null;
          created_at: string;
          cron_job_id: string | null;
          explorer_url: string | null;
          id: string;
          job_id: string | null;
          payload: Json;
          pending_action_id: string | null;
          receipt_type: string;
          source_surface: string;
          status: string;
          summary: string;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          tx_hash: string | null;
          user_id: string;
          work_item_id: string | null;
          x_thread_id: string | null;
        };
        Insert: {
          canonical_record_id?: string | null;
          canonical_record_type?: string | null;
          chain?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          explorer_url?: string | null;
          id?: string;
          job_id?: string | null;
          payload?: Json;
          pending_action_id?: string | null;
          receipt_type: string;
          source_surface?: string;
          status: string;
          summary: string;
          surface: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          tx_hash?: string | null;
          user_id: string;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Update: {
          canonical_record_id?: string | null;
          canonical_record_type?: string | null;
          chain?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          explorer_url?: string | null;
          id?: string;
          job_id?: string | null;
          payload?: Json;
          pending_action_id?: string | null;
          receipt_type?: string;
          source_surface?: string;
          status?: string;
          summary?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          tx_hash?: string | null;
          user_id?: string;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_action_receipts_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "linkr_action_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_receipts_pending_action_id_fkey";
            columns: ["pending_action_id"];
            isOneToOne: false;
            referencedRelation: "linkr_pending_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_receipts_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_action_receipts_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_agent_locks: {
        Row: {
          created_at: string;
          expires_at: string;
          lock_key: string;
          owner_id: string;
          run_id: string | null;
          scope_id: string;
          scope_type: string;
          surface: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          lock_key: string;
          owner_id: string;
          run_id?: string | null;
          scope_id: string;
          scope_type: string;
          surface: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          lock_key?: string;
          owner_id?: string;
          run_id?: string | null;
          scope_id?: string;
          scope_type?: string;
          surface?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_agent_locks_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "linkr_agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_agent_runs: {
        Row: {
          assistant_message_id: string | null;
          classification: Json | null;
          completed_at: string | null;
          completion_tokens: number | null;
          created_at: string;
          cron_job_id: string | null;
          error: string | null;
          extraction: Json | null;
          id: string;
          idempotency_key: string | null;
          model: string | null;
          outcome: Json | null;
          prompt_tokens: number | null;
          reply_plan: Json | null;
          retrieval_request: Json | null;
          retrieved_history: Json | null;
          route_decision: Json | null;
          source_surface: string;
          started_at: string | null;
          status: string;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          tool_results: Json;
          updated_at: string;
          user_id: string | null;
          user_message_id: string | null;
          working_frame: Json | null;
          x_thread_id: string | null;
        };
        Insert: {
          assistant_message_id?: string | null;
          classification?: Json | null;
          completed_at?: string | null;
          completion_tokens?: number | null;
          created_at?: string;
          cron_job_id?: string | null;
          error?: string | null;
          extraction?: Json | null;
          id?: string;
          idempotency_key?: string | null;
          model?: string | null;
          outcome?: Json | null;
          prompt_tokens?: number | null;
          reply_plan?: Json | null;
          retrieval_request?: Json | null;
          retrieved_history?: Json | null;
          route_decision?: Json | null;
          source_surface?: string;
          started_at?: string | null;
          status?: string;
          surface: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          tool_results?: Json;
          updated_at?: string;
          user_id?: string | null;
          user_message_id?: string | null;
          working_frame?: Json | null;
          x_thread_id?: string | null;
        };
        Update: {
          assistant_message_id?: string | null;
          classification?: Json | null;
          completed_at?: string | null;
          completion_tokens?: number | null;
          created_at?: string;
          cron_job_id?: string | null;
          error?: string | null;
          extraction?: Json | null;
          id?: string;
          idempotency_key?: string | null;
          model?: string | null;
          outcome?: Json | null;
          prompt_tokens?: number | null;
          reply_plan?: Json | null;
          retrieval_request?: Json | null;
          retrieved_history?: Json | null;
          route_decision?: Json | null;
          source_surface?: string;
          started_at?: string | null;
          status?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          tool_results?: Json;
          updated_at?: string;
          user_id?: string | null;
          user_message_id?: string | null;
          working_frame?: Json | null;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_agent_runs_assistant_message_id_fkey";
            columns: ["assistant_message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_agent_runs_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_agent_runs_user_message_id_fkey";
            columns: ["user_message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_capacity_change_events: {
        Row: {
          actor: string;
          created_at: string;
          id: number;
          new_enabled_slots: number;
          old_enabled_slots: number | null;
          reason: string;
          stage: string;
        };
        Insert: {
          actor: string;
          created_at?: string;
          id?: never;
          new_enabled_slots: number;
          old_enabled_slots?: number | null;
          reason: string;
          stage: string;
        };
        Update: {
          actor?: string;
          created_at?: string;
          id?: never;
          new_enabled_slots?: number;
          old_enabled_slots?: number | null;
          reason?: string;
          stage?: string;
        };
        Relationships: [];
      };
      linkr_chain_transactions: {
        Row: {
          attempt_number: number;
          blockhash: string | null;
          broadcast_at: string | null;
          chain: string;
          confirmed_at: string | null;
          created_at: string;
          encrypted_key_material: string | null;
          gas_policy: Json | null;
          id: string;
          last_error_code: string | null;
          last_valid_block_height: number | null;
          launch_id: string | null;
          nonce: number | null;
          payload_hash: string | null;
          predicted_address: string | null;
          signature: string | null;
          signed_transaction: string;
          signed_transaction_hash: string;
          state: string;
          transaction_hash: string | null;
          updated_at: string;
          wallet_id: string | null;
          work_item_id: string;
        };
        Insert: {
          attempt_number?: number;
          blockhash?: string | null;
          broadcast_at?: string | null;
          chain: string;
          confirmed_at?: string | null;
          created_at?: string;
          encrypted_key_material?: string | null;
          gas_policy?: Json | null;
          id?: string;
          last_error_code?: string | null;
          last_valid_block_height?: number | null;
          launch_id?: string | null;
          nonce?: number | null;
          payload_hash?: string | null;
          predicted_address?: string | null;
          signature?: string | null;
          signed_transaction: string;
          signed_transaction_hash: string;
          state?: string;
          transaction_hash?: string | null;
          updated_at?: string;
          wallet_id?: string | null;
          work_item_id: string;
        };
        Update: {
          attempt_number?: number;
          blockhash?: string | null;
          broadcast_at?: string | null;
          chain?: string;
          confirmed_at?: string | null;
          created_at?: string;
          encrypted_key_material?: string | null;
          gas_policy?: Json | null;
          id?: string;
          last_error_code?: string | null;
          last_valid_block_height?: number | null;
          launch_id?: string | null;
          nonce?: number | null;
          payload_hash?: string | null;
          predicted_address?: string | null;
          signature?: string | null;
          signed_transaction?: string;
          signed_transaction_hash?: string;
          state?: string;
          transaction_hash?: string | null;
          updated_at?: string;
          wallet_id?: string | null;
          work_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_chain_transactions_launch_id_fkey";
            columns: ["launch_id"];
            isOneToOne: false;
            referencedRelation: "coin_launches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_chain_transactions_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_chain_transactions_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_conversation_state: {
        Row: {
          active_entities: Json;
          active_topic: Json | null;
          anti_repetition: Json;
          conversation_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          last_reply_tweet_id: string | null;
          last_route: string | null;
          participant_twitter_id: string;
          privacy_label: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          active_entities?: Json;
          active_topic?: Json | null;
          anti_repetition?: Json;
          conversation_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_reply_tweet_id?: string | null;
          last_route?: string | null;
          participant_twitter_id: string;
          privacy_label?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          active_entities?: Json;
          active_topic?: Json | null;
          anti_repetition?: Json;
          conversation_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_reply_tweet_id?: string | null;
          last_route?: string | null;
          participant_twitter_id?: string;
          privacy_label?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      linkr_dead_letter_items: {
        Row: {
          created_at: string;
          error_fingerprint: string | null;
          id: string;
          last_redriven_at: string | null;
          pgmq_message_id: number | null;
          reason_code: string;
          redrive_count: number;
          redrive_state: string;
          resolved_at: string | null;
          route: string;
          updated_at: string;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          error_fingerprint?: string | null;
          id?: string;
          last_redriven_at?: string | null;
          pgmq_message_id?: number | null;
          reason_code: string;
          redrive_count?: number;
          redrive_state?: string;
          resolved_at?: string | null;
          route: string;
          updated_at?: string;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          error_fingerprint?: string | null;
          id?: string;
          last_redriven_at?: string | null;
          pgmq_message_id?: number | null;
          reason_code?: string;
          redrive_count?: number;
          redrive_state?: string;
          resolved_at?: string | null;
          route?: string;
          updated_at?: string;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_dispatch_stage_state: {
        Row: {
          circuit_open_until: string | null;
          consecutive_failure_count: number;
          failure_count: number;
          last_completed_at: string | null;
          last_error_code: string | null;
          last_failure_at: string | null;
          last_request_id: number | null;
          last_requested_at: string | null;
          last_started_at: string | null;
          last_status_code: number | null;
          lease_expires_at: string | null;
          lease_owner: string | null;
          required_consumer_version: string | null;
          stage: string;
          state: string;
          success_count: number;
          updated_at: string;
          wake_generation: number;
        };
        Insert: {
          circuit_open_until?: string | null;
          consecutive_failure_count?: number;
          failure_count?: number;
          last_completed_at?: string | null;
          last_error_code?: string | null;
          last_failure_at?: string | null;
          last_request_id?: number | null;
          last_requested_at?: string | null;
          last_started_at?: string | null;
          last_status_code?: number | null;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          required_consumer_version?: string | null;
          stage: string;
          state?: string;
          success_count?: number;
          updated_at?: string;
          wake_generation?: number;
        };
        Update: {
          circuit_open_until?: string | null;
          consecutive_failure_count?: number;
          failure_count?: number;
          last_completed_at?: string | null;
          last_error_code?: string | null;
          last_failure_at?: string | null;
          last_request_id?: number | null;
          last_requested_at?: string | null;
          last_started_at?: string | null;
          last_status_code?: number | null;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          required_consumer_version?: string | null;
          stage?: string;
          state?: string;
          success_count?: number;
          updated_at?: string;
          wake_generation?: number;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_dispatch_stage_state_stage_fkey";
            columns: ["stage"];
            isOneToOne: true;
            referencedRelation: "linkr_queue_runtime_config";
            referencedColumns: ["stage"];
          },
        ];
      };
      linkr_edge_dispatch_failures: {
        Row: {
          created_at: string;
          error_code: string;
          error_message: string | null;
          id: number;
          request_id: number | null;
          stage: string;
          status_code: number | null;
          timed_out: boolean;
          wake_generation: number | null;
        };
        Insert: {
          created_at?: string;
          error_code: string;
          error_message?: string | null;
          id?: never;
          request_id?: number | null;
          stage: string;
          status_code?: number | null;
          timed_out?: boolean;
          wake_generation?: number | null;
        };
        Update: {
          created_at?: string;
          error_code?: string;
          error_message?: string | null;
          id?: never;
          request_id?: number | null;
          stage?: string;
          status_code?: number | null;
          timed_out?: boolean;
          wake_generation?: number | null;
        };
        Relationships: [];
      };
      linkr_edge_worker_dispatches: {
        Row: {
          dispatched_at: string;
          function_name: string;
          health_source: string;
          request_id: number;
        };
        Insert: {
          dispatched_at?: string;
          function_name: string;
          health_source: string;
          request_id: number;
        };
        Update: {
          dispatched_at?: string;
          function_name?: string;
          health_source?: string;
          request_id?: number;
        };
        Relationships: [];
      };
      linkr_external_data_cache: {
        Row: {
          cache_key: string;
          etag: string | null;
          expires_at: string;
          fetched_at: string;
          metadata: Json;
          payload: Json;
          privacy_label: string;
          source_ref_key: string;
          source_type: string;
        };
        Insert: {
          cache_key: string;
          etag?: string | null;
          expires_at: string;
          fetched_at?: string;
          metadata?: Json;
          payload: Json;
          privacy_label?: string;
          source_ref_key: string;
          source_type: string;
        };
        Update: {
          cache_key?: string;
          etag?: string | null;
          expires_at?: string;
          fetched_at?: string;
          metadata?: Json;
          payload?: Json;
          privacy_label?: string;
          source_ref_key?: string;
          source_type?: string;
        };
        Relationships: [];
      };
      linkr_idempotency_tombstones: {
        Row: {
          created_at: string;
          expires_at: string;
          idempotency_key: string;
          result_ref: string | null;
          terminal_at: string;
          terminal_state: string;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          idempotency_key: string;
          result_ref?: string | null;
          terminal_at: string;
          terminal_state: string;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          idempotency_key?: string;
          result_ref?: string | null;
          terminal_at?: string;
          terminal_state?: string;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_memory_events: {
        Row: {
          created_at: string;
          cron_job_id: string | null;
          event_type: string;
          id: string;
          memory_source_id: string | null;
          memory_source_type: string | null;
          message_id: string | null;
          metadata: Json;
          privacy_label: string;
          run_id: string | null;
          summary: string;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          title: string | null;
          user_id: string;
          x_thread_id: string | null;
        };
        Insert: {
          created_at?: string;
          cron_job_id?: string | null;
          event_type: string;
          id?: string;
          memory_source_id?: string | null;
          memory_source_type?: string | null;
          message_id?: string | null;
          metadata?: Json;
          privacy_label?: string;
          run_id?: string | null;
          summary: string;
          surface: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          title?: string | null;
          user_id: string;
          x_thread_id?: string | null;
        };
        Update: {
          created_at?: string;
          cron_job_id?: string | null;
          event_type?: string;
          id?: string;
          memory_source_id?: string | null;
          memory_source_type?: string | null;
          message_id?: string | null;
          metadata?: Json;
          privacy_label?: string;
          run_id?: string | null;
          summary?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          title?: string | null;
          user_id?: string;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_memory_events_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_memory_events_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "linkr_agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_memory_events_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_notification_deliveries: {
        Row: {
          ambiguous_at: string | null;
          attempt_count: number;
          channel: string;
          content_hash: string;
          created_at: string;
          destination_ref: string;
          id: string;
          idempotency_key: string;
          last_error_code: string | null;
          provider_message_id: string | null;
          sent_at: string | null;
          state: string;
          updated_at: string;
          work_item_id: string;
        };
        Insert: {
          ambiguous_at?: string | null;
          attempt_count?: number;
          channel: string;
          content_hash: string;
          created_at?: string;
          destination_ref: string;
          id?: string;
          idempotency_key: string;
          last_error_code?: string | null;
          provider_message_id?: string | null;
          sent_at?: string | null;
          state?: string;
          updated_at?: string;
          work_item_id: string;
        };
        Update: {
          ambiguous_at?: string | null;
          attempt_count?: number;
          channel?: string;
          content_hash?: string;
          created_at?: string;
          destination_ref?: string;
          id?: string;
          idempotency_key?: string;
          last_error_code?: string | null;
          provider_message_id?: string | null;
          sent_at?: string | null;
          state?: string;
          updated_at?: string;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_pending_actions: {
        Row: {
          action_payload: Json;
          action_type: string;
          assistant_message_id: string | null;
          cancelled_at: string | null;
          confirmation_phrase: string;
          confirmed_at: string | null;
          created_at: string;
          cron_job_id: string | null;
          deterministic_validation: Json;
          draft_id: string | null;
          draft_version: number | null;
          expires_at: string;
          id: string;
          idempotency_key: string;
          risk_summary: Json;
          source_refs: Json;
          source_surface: string;
          status: string;
          summary: string;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          updated_at: string;
          user_id: string;
          user_message_id: string | null;
          work_item_id: string | null;
          x_thread_id: string | null;
        };
        Insert: {
          action_payload: Json;
          action_type: string;
          assistant_message_id?: string | null;
          cancelled_at?: string | null;
          confirmation_phrase: string;
          confirmed_at?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          deterministic_validation?: Json;
          draft_id?: string | null;
          draft_version?: number | null;
          expires_at: string;
          id?: string;
          idempotency_key: string;
          risk_summary?: Json;
          source_refs?: Json;
          source_surface?: string;
          status?: string;
          summary: string;
          surface: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          user_id: string;
          user_message_id?: string | null;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Update: {
          action_payload?: Json;
          action_type?: string;
          assistant_message_id?: string | null;
          cancelled_at?: string | null;
          confirmation_phrase?: string;
          confirmed_at?: string | null;
          created_at?: string;
          cron_job_id?: string | null;
          deterministic_validation?: Json;
          draft_id?: string | null;
          draft_version?: number | null;
          expires_at?: string;
          id?: string;
          idempotency_key?: string;
          risk_summary?: Json;
          source_refs?: Json;
          source_surface?: string;
          status?: string;
          summary?: string;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          user_id?: string;
          user_message_id?: string | null;
          work_item_id?: string | null;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_pending_actions_assistant_message_id_fkey";
            columns: ["assistant_message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_pending_actions_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "linkr_action_drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_pending_actions_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_pending_actions_user_message_id_fkey";
            columns: ["user_message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_pending_actions_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_platform_capacity_buckets: {
        Row: {
          active_connections: number | null;
          bucket_at: string;
          database_size_bytes: number;
          dead_tuple_estimate: number | null;
          details: Json;
          queue_size_bytes: number;
          total_connections: number | null;
        };
        Insert: {
          active_connections?: number | null;
          bucket_at: string;
          database_size_bytes: number;
          dead_tuple_estimate?: number | null;
          details?: Json;
          queue_size_bytes: number;
          total_connections?: number | null;
        };
        Update: {
          active_connections?: number | null;
          bucket_at?: string;
          database_size_bytes?: number;
          dead_tuple_estimate?: number | null;
          details?: Json;
          queue_size_bytes?: number;
          total_connections?: number | null;
        };
        Relationships: [];
      };
      linkr_platform_control: {
        Row: {
          configured_storage_budget_bytes: number | null;
          controller_fencing_token: number;
          last_active_sample_at: string | null;
          last_deep_sample_at: string | null;
          metrics_sampled_at: string | null;
          mode: string;
          reason: string | null;
          singleton: boolean;
          threshold_band: string;
          updated_at: string;
        };
        Insert: {
          configured_storage_budget_bytes?: number | null;
          controller_fencing_token?: number;
          last_active_sample_at?: string | null;
          last_deep_sample_at?: string | null;
          metrics_sampled_at?: string | null;
          mode?: string;
          reason?: string | null;
          singleton?: boolean;
          threshold_band?: string;
          updated_at?: string;
        };
        Update: {
          configured_storage_budget_bytes?: number | null;
          controller_fencing_token?: number;
          last_active_sample_at?: string | null;
          last_deep_sample_at?: string | null;
          metrics_sampled_at?: string | null;
          mode?: string;
          reason?: string | null;
          singleton?: boolean;
          threshold_band?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      linkr_platform_incidents: {
        Row: {
          details: Json;
          fingerprint: string;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          occurrence_count: number;
          resolved_at: string | null;
          severity: string;
          state: string;
          title: string;
        };
        Insert: {
          details?: Json;
          fingerprint: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          occurrence_count?: number;
          resolved_at?: string | null;
          severity: string;
          state?: string;
          title: string;
        };
        Update: {
          details?: Json;
          fingerprint?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          occurrence_count?: number;
          resolved_at?: string | null;
          severity?: string;
          state?: string;
          title?: string;
        };
        Relationships: [];
      };
      linkr_post_intelligence: {
        Row: {
          created_at: string;
          entities: Json;
          expires_at: string;
          facts: Json;
          id: string;
          media_summaries: Json;
          privacy_label: string;
          prompt_version: string | null;
          source_hash: string;
          summary: string;
          tweet_id: string;
        };
        Insert: {
          created_at?: string;
          entities?: Json;
          expires_at?: string;
          facts?: Json;
          id?: string;
          media_summaries?: Json;
          privacy_label?: string;
          prompt_version?: string | null;
          source_hash: string;
          summary: string;
          tweet_id: string;
        };
        Update: {
          created_at?: string;
          entities?: Json;
          expires_at?: string;
          facts?: Json;
          id?: string;
          media_summaries?: Json;
          privacy_label?: string;
          prompt_version?: string | null;
          source_hash?: string;
          summary?: string;
          tweet_id?: string;
        };
        Relationships: [];
      };
      linkr_provider_health: {
        Row: {
          consecutive_failures: number;
          cooldown_until: string | null;
          endpoint_identity: string;
          last_failure_at: string | null;
          last_success_at: string | null;
          latency_ms_ema: number | null;
          provider_kind: string;
          provider_label: string;
          sampled_at: string | null;
          state: string;
          updated_at: string;
        };
        Insert: {
          consecutive_failures?: number;
          cooldown_until?: string | null;
          endpoint_identity: string;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          latency_ms_ema?: number | null;
          provider_kind: string;
          provider_label: string;
          sampled_at?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          consecutive_failures?: number;
          cooldown_until?: string | null;
          endpoint_identity?: string;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          latency_ms_ema?: number | null;
          provider_kind?: string;
          provider_label?: string;
          sampled_at?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      linkr_queue_health_buckets: {
        Row: {
          bucket_at: string;
          dispatch_failure_count: number;
          dispatch_success_count: number;
          oldest_age_seconds_max: number;
          queue_length_max: number;
          sample_count: number;
          stage: string;
        };
        Insert: {
          bucket_at: string;
          dispatch_failure_count?: number;
          dispatch_success_count?: number;
          oldest_age_seconds_max?: number;
          queue_length_max?: number;
          sample_count?: number;
          stage: string;
        };
        Update: {
          bucket_at?: string;
          dispatch_failure_count?: number;
          dispatch_success_count?: number;
          oldest_age_seconds_max?: number;
          queue_length_max?: number;
          sample_count?: number;
          stage?: string;
        };
        Relationships: [];
      };
      linkr_queue_runtime_config: {
        Row: {
          batch_size: number;
          canary_user_ids: string[];
          consumer_version: string;
          dispatch_weight: number;
          enabled: boolean;
          max_concurrency: number;
          min_concurrency: number;
          observation_started_at: string | null;
          pause_reason: string | null;
          rollout_percent: number;
          routed_count: number;
          stage: string;
          target_oldest_age_seconds: number;
          updated_at: string;
          visibility_timeout_seconds: number;
          worker_function: string;
        };
        Insert: {
          batch_size?: number;
          canary_user_ids?: string[];
          consumer_version?: string;
          dispatch_weight?: number;
          enabled?: boolean;
          max_concurrency?: number;
          min_concurrency?: number;
          observation_started_at?: string | null;
          pause_reason?: string | null;
          rollout_percent?: number;
          routed_count?: number;
          stage: string;
          target_oldest_age_seconds?: number;
          updated_at?: string;
          visibility_timeout_seconds?: number;
          worker_function: string;
        };
        Update: {
          batch_size?: number;
          canary_user_ids?: string[];
          consumer_version?: string;
          dispatch_weight?: number;
          enabled?: boolean;
          max_concurrency?: number;
          min_concurrency?: number;
          observation_started_at?: string | null;
          pause_reason?: string | null;
          rollout_percent?: number;
          routed_count?: number;
          stage?: string;
          target_oldest_age_seconds?: number;
          updated_at?: string;
          visibility_timeout_seconds?: number;
          worker_function?: string;
        };
        Relationships: [];
      };
      linkr_rate_limit_windows: {
        Row: {
          request_count: number;
          subject_id: string;
          subject_type: string;
          updated_at: string;
          window_seconds: number;
          window_start: string;
        };
        Insert: {
          request_count?: number;
          subject_id: string;
          subject_type: string;
          updated_at?: string;
          window_seconds: number;
          window_start: string;
        };
        Update: {
          request_count?: number;
          subject_id?: string;
          subject_type?: string;
          updated_at?: string;
          window_seconds?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      linkr_request_events: {
        Row: {
          created_at: string;
          error_code: string | null;
          event_type: string;
          id: number;
          metadata: Json;
          state: string | null;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          error_code?: string | null;
          event_type: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          event_type?: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_request_events_202607: {
        Row: {
          created_at: string;
          error_code: string | null;
          event_type: string;
          id: number;
          metadata: Json;
          state: string | null;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          error_code?: string | null;
          event_type: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          event_type?: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_request_events_202608: {
        Row: {
          created_at: string;
          error_code: string | null;
          event_type: string;
          id: number;
          metadata: Json;
          state: string | null;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          error_code?: string | null;
          event_type: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          event_type?: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_request_events_202609: {
        Row: {
          created_at: string;
          error_code: string | null;
          event_type: string;
          id: number;
          metadata: Json;
          state: string | null;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          error_code?: string | null;
          event_type: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          event_type?: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_request_events_default: {
        Row: {
          created_at: string;
          error_code: string | null;
          event_type: string;
          id: number;
          metadata: Json;
          state: string | null;
          work_item_id: string;
        };
        Insert: {
          created_at?: string;
          error_code?: string | null;
          event_type: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          event_type?: string;
          id?: never;
          metadata?: Json;
          state?: string | null;
          work_item_id?: string;
        };
        Relationships: [];
      };
      linkr_resource_heads: {
        Row: {
          active_sequence: number | null;
          active_work_item_id: string | null;
          fencing_token: number;
          lease_expires_at: string | null;
          lease_owner: string | null;
          next_sequence: number;
          resource_key: string;
          resource_type: string;
          updated_at: string;
        };
        Insert: {
          active_sequence?: number | null;
          active_work_item_id?: string | null;
          fencing_token?: number;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          next_sequence?: number;
          resource_key: string;
          resource_type: string;
          updated_at?: string;
        };
        Update: {
          active_sequence?: number | null;
          active_work_item_id?: string | null;
          fencing_token?: number;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          next_sequence?: number;
          resource_key?: string;
          resource_type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      linkr_shadow_receipts: {
        Row: {
          payload_hash: string | null;
          route: string;
          source_event_id: string | null;
          source_surface: string;
          validated_at: string;
          work_item_id: string;
        };
        Insert: {
          payload_hash?: string | null;
          route: string;
          source_event_id?: string | null;
          source_surface: string;
          validated_at?: string;
          work_item_id: string;
        };
        Update: {
          payload_hash?: string | null;
          route?: string;
          source_event_id?: string | null;
          source_surface?: string;
          validated_at?: string;
          work_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_shadow_receipts_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: true;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_source_refs: {
        Row: {
          confidence: number;
          created_at: string;
          cron_job_id: string | null;
          freshness: string;
          id: string;
          label: string | null;
          message_id: string | null;
          privacy_label: string;
          ref_key: string;
          ref_type: string;
          resolved_payload: Json;
          run_id: string | null;
          source_payload: Json;
          surface: string;
          surface_conversation_id: string | null;
          terminal_conversation_id: string | null;
          updated_at: string;
          url: string | null;
          user_id: string;
          x_thread_id: string | null;
        };
        Insert: {
          confidence?: number;
          created_at?: string;
          cron_job_id?: string | null;
          freshness?: string;
          id?: string;
          label?: string | null;
          message_id?: string | null;
          privacy_label?: string;
          ref_key: string;
          ref_type: string;
          resolved_payload?: Json;
          run_id?: string | null;
          source_payload?: Json;
          surface: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          url?: string | null;
          user_id: string;
          x_thread_id?: string | null;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          cron_job_id?: string | null;
          freshness?: string;
          id?: string;
          label?: string | null;
          message_id?: string | null;
          privacy_label?: string;
          ref_key?: string;
          ref_type?: string;
          resolved_payload?: Json;
          run_id?: string | null;
          source_payload?: Json;
          surface?: string;
          surface_conversation_id?: string | null;
          terminal_conversation_id?: string | null;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
          x_thread_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_source_refs_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_source_refs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "linkr_agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_source_refs_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_terminal_conversations: {
        Row: {
          active_entities: Json;
          active_topic: Json | null;
          archived_at: string | null;
          created_at: string;
          deleted_at: string | null;
          id: string;
          last_message_at: string | null;
          last_message_preview: string | null;
          last_message_role: string | null;
          message_count: number;
          pending_action_count: number;
          pinned_context: Json;
          source: string;
          status: string;
          summary: string | null;
          title: string | null;
          total_completion_tokens: number;
          total_prompt_tokens: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active_entities?: Json;
          active_topic?: Json | null;
          archived_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          last_message_role?: string | null;
          message_count?: number;
          pending_action_count?: number;
          pinned_context?: Json;
          source?: string;
          status?: string;
          summary?: string | null;
          title?: string | null;
          total_completion_tokens?: number;
          total_prompt_tokens?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active_entities?: Json;
          active_topic?: Json | null;
          archived_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          last_message_role?: string | null;
          message_count?: number;
          pending_action_count?: number;
          pinned_context?: Json;
          source?: string;
          status?: string;
          summary?: string | null;
          title?: string | null;
          total_completion_tokens?: number;
          total_prompt_tokens?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      linkr_terminal_events: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          payload: Json;
          run_id: string | null;
          type: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          run_id?: string | null;
          type: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          run_id?: string | null;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_terminal_events_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "linkr_terminal_events_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "linkr_agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_terminal_messages: {
        Row: {
          client_message_id: string | null;
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          idempotency_key: string | null;
          metadata: Json;
          parts: Json;
          role: string;
          source_refs: Json;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          client_message_id?: string | null;
          content?: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          metadata?: Json;
          parts?: Json;
          role: string;
          source_refs?: Json;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_message_id?: string | null;
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          metadata?: Json;
          parts?: Json;
          role?: string;
          source_refs?: Json;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_terminal_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_tool_result_cache: {
        Row: {
          cache_key: string;
          confidence: number;
          created_at: string;
          expires_at: string;
          freshness: string;
          id: string;
          input_hash: string;
          privacy_label: string;
          result: Json;
          tool: string;
        };
        Insert: {
          cache_key: string;
          confidence?: number;
          created_at?: string;
          expires_at: string;
          freshness?: string;
          id?: string;
          input_hash: string;
          privacy_label?: string;
          result: Json;
          tool: string;
        };
        Update: {
          cache_key?: string;
          confidence?: number;
          created_at?: string;
          expires_at?: string;
          freshness?: string;
          id?: string;
          input_hash?: string;
          privacy_label?: string;
          result?: Json;
          tool?: string;
        };
        Relationships: [];
      };
      linkr_work_items: {
        Row: {
          accepted_at: string;
          active_message_id: number | null;
          active_queue_name: string | null;
          attempt_count: number;
          consumer_version: string;
          conversation_id: string | null;
          created_at: string;
          dispatch_generation: number;
          execution_generation: number;
          id: string;
          idempotency_key: string;
          last_enqueued_at: string | null;
          last_error_code: string | null;
          last_progress_at: string;
          lease_expires_at: string | null;
          next_attempt_at: string | null;
          parent_work_item_id: string | null;
          payload: Json | null;
          payload_hash: string | null;
          payload_ref: string | null;
          priority: number;
          recovery_count: number;
          request_type: string;
          resource_key: string | null;
          resource_sequence: number | null;
          resource_type: string | null;
          result_ref: string | null;
          route: string;
          source_event_id: string | null;
          source_surface: string;
          started_at: string | null;
          state: string;
          state_version: number;
          surface_conversation_id: string | null;
          terminal_at: string | null;
          trace_id: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          accepted_at?: string;
          active_message_id?: number | null;
          active_queue_name?: string | null;
          attempt_count?: number;
          consumer_version?: string;
          conversation_id?: string | null;
          created_at?: string;
          dispatch_generation?: number;
          execution_generation?: number;
          id?: string;
          idempotency_key: string;
          last_enqueued_at?: string | null;
          last_error_code?: string | null;
          last_progress_at?: string;
          lease_expires_at?: string | null;
          next_attempt_at?: string | null;
          parent_work_item_id?: string | null;
          payload?: Json | null;
          payload_hash?: string | null;
          payload_ref?: string | null;
          priority?: number;
          recovery_count?: number;
          request_type: string;
          resource_key?: string | null;
          resource_sequence?: number | null;
          resource_type?: string | null;
          result_ref?: string | null;
          route: string;
          source_event_id?: string | null;
          source_surface: string;
          started_at?: string | null;
          state?: string;
          state_version?: number;
          surface_conversation_id?: string | null;
          terminal_at?: string | null;
          trace_id?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          accepted_at?: string;
          active_message_id?: number | null;
          active_queue_name?: string | null;
          attempt_count?: number;
          consumer_version?: string;
          conversation_id?: string | null;
          created_at?: string;
          dispatch_generation?: number;
          execution_generation?: number;
          id?: string;
          idempotency_key?: string;
          last_enqueued_at?: string | null;
          last_error_code?: string | null;
          last_progress_at?: string;
          lease_expires_at?: string | null;
          next_attempt_at?: string | null;
          parent_work_item_id?: string | null;
          payload?: Json | null;
          payload_hash?: string | null;
          payload_ref?: string | null;
          priority?: number;
          recovery_count?: number;
          request_type?: string;
          resource_key?: string | null;
          resource_sequence?: number | null;
          resource_type?: string | null;
          result_ref?: string | null;
          route?: string;
          source_event_id?: string | null;
          source_surface?: string;
          started_at?: string | null;
          state?: string;
          state_version?: number;
          surface_conversation_id?: string | null;
          terminal_at?: string | null;
          trace_id?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "linkr_work_items_parent_work_item_id_fkey";
            columns: ["parent_work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      linkr_worker_attempt_details: {
        Row: {
          attempt_number: number;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
          id: number;
          metadata: Json;
          outcome: string | null;
          stage: string;
          started_at: string;
          work_item_id: string;
          worker_id: string;
        };
        Insert: {
          attempt_number: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage: string;
          started_at?: string;
          work_item_id: string;
          worker_id: string;
        };
        Update: {
          attempt_number?: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage?: string;
          started_at?: string;
          work_item_id?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      linkr_worker_attempt_details_202607: {
        Row: {
          attempt_number: number;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
          id: number;
          metadata: Json;
          outcome: string | null;
          stage: string;
          started_at: string;
          work_item_id: string;
          worker_id: string;
        };
        Insert: {
          attempt_number: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage: string;
          started_at?: string;
          work_item_id: string;
          worker_id: string;
        };
        Update: {
          attempt_number?: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage?: string;
          started_at?: string;
          work_item_id?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      linkr_worker_attempt_details_202608: {
        Row: {
          attempt_number: number;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
          id: number;
          metadata: Json;
          outcome: string | null;
          stage: string;
          started_at: string;
          work_item_id: string;
          worker_id: string;
        };
        Insert: {
          attempt_number: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage: string;
          started_at?: string;
          work_item_id: string;
          worker_id: string;
        };
        Update: {
          attempt_number?: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage?: string;
          started_at?: string;
          work_item_id?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      linkr_worker_attempt_details_202609: {
        Row: {
          attempt_number: number;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
          id: number;
          metadata: Json;
          outcome: string | null;
          stage: string;
          started_at: string;
          work_item_id: string;
          worker_id: string;
        };
        Insert: {
          attempt_number: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage: string;
          started_at?: string;
          work_item_id: string;
          worker_id: string;
        };
        Update: {
          attempt_number?: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage?: string;
          started_at?: string;
          work_item_id?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      linkr_worker_attempt_details_default: {
        Row: {
          attempt_number: number;
          completed_at: string | null;
          duration_ms: number | null;
          error_code: string | null;
          id: number;
          metadata: Json;
          outcome: string | null;
          stage: string;
          started_at: string;
          work_item_id: string;
          worker_id: string;
        };
        Insert: {
          attempt_number: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage: string;
          started_at?: string;
          work_item_id: string;
          worker_id: string;
        };
        Update: {
          attempt_number?: number;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: never;
          metadata?: Json;
          outcome?: string | null;
          stage?: string;
          started_at?: string;
          work_item_id?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      linkr_worker_capacity_slots: {
        Row: {
          enabled: boolean;
          fencing_token: number;
          lease_expires_at: string | null;
          lease_owner: string | null;
          slot_number: number;
          stage: string;
          updated_at: string;
          work_item_id: string | null;
        };
        Insert: {
          enabled?: boolean;
          fencing_token?: number;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          slot_number: number;
          stage: string;
          updated_at?: string;
          work_item_id?: string | null;
        };
        Update: {
          enabled?: boolean;
          fencing_token?: number;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          slot_number?: number;
          stage?: string;
          updated_at?: string;
          work_item_id?: string | null;
        };
        Relationships: [];
      };
      liquidity_actions: {
        Row: {
          action: string;
          amount_native_raw: string | null;
          amount_token_wei: string | null;
          amount_weth_wei: string | null;
          chain: string;
          created_at: string;
          error_message: string | null;
          fees_token_wei: string | null;
          fees_weth_wei: string | null;
          id: string;
          idempotency_key: string | null;
          liquidity_delta: string | null;
          native_symbol: string;
          pending_action_id: string | null;
          platform: string | null;
          pool_address: string | null;
          pool_fee: number | null;
          position_token_id: string | null;
          receipt: Json;
          requested_eth_wei: string | null;
          requested_native_raw: string | null;
          requested_percent: number | null;
          requested_token_wei: string | null;
          simulation: Json;
          source_surface: string;
          status: string;
          terminal_conversation_id: string | null;
          terminal_message_id: string | null;
          tick_lower: number | null;
          tick_upper: number | null;
          token_address: string;
          token_symbol: string | null;
          tx_hash: string | null;
          updated_at: string;
          user_id: string;
          wallet_address: string;
          wallet_id: string | null;
        };
        Insert: {
          action: string;
          amount_native_raw?: string | null;
          amount_token_wei?: string | null;
          amount_weth_wei?: string | null;
          chain?: string;
          created_at?: string;
          error_message?: string | null;
          fees_token_wei?: string | null;
          fees_weth_wei?: string | null;
          id?: string;
          idempotency_key?: string | null;
          liquidity_delta?: string | null;
          native_symbol?: string;
          pending_action_id?: string | null;
          platform?: string | null;
          pool_address?: string | null;
          pool_fee?: number | null;
          position_token_id?: string | null;
          receipt?: Json;
          requested_eth_wei?: string | null;
          requested_native_raw?: string | null;
          requested_percent?: number | null;
          requested_token_wei?: string | null;
          simulation?: Json;
          source_surface?: string;
          status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          tick_lower?: number | null;
          tick_upper?: number | null;
          token_address: string;
          token_symbol?: string | null;
          tx_hash?: string | null;
          updated_at?: string;
          user_id: string;
          wallet_address: string;
          wallet_id?: string | null;
        };
        Update: {
          action?: string;
          amount_native_raw?: string | null;
          amount_token_wei?: string | null;
          amount_weth_wei?: string | null;
          chain?: string;
          created_at?: string;
          error_message?: string | null;
          fees_token_wei?: string | null;
          fees_weth_wei?: string | null;
          id?: string;
          idempotency_key?: string | null;
          liquidity_delta?: string | null;
          native_symbol?: string;
          pending_action_id?: string | null;
          platform?: string | null;
          pool_address?: string | null;
          pool_fee?: number | null;
          position_token_id?: string | null;
          receipt?: Json;
          requested_eth_wei?: string | null;
          requested_native_raw?: string | null;
          requested_percent?: number | null;
          requested_token_wei?: string | null;
          simulation?: Json;
          source_surface?: string;
          status?: string;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          tick_lower?: number | null;
          tick_upper?: number | null;
          token_address?: string;
          token_symbol?: string | null;
          tx_hash?: string | null;
          updated_at?: string;
          user_id?: string;
          wallet_address?: string;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "liquidity_actions_pending_action_id_fkey";
            columns: ["pending_action_id"];
            isOneToOne: false;
            referencedRelation: "pending_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "liquidity_actions_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      liquidity_positions: {
        Row: {
          amount_native_raw: string | null;
          amount_token_raw: string | null;
          amount_token_wei: string | null;
          amount_weth_wei: string | null;
          chain: string;
          closed_tx_hash: string | null;
          created_at: string;
          id: string;
          in_range: boolean | null;
          last_chain_refresh_at: string | null;
          last_tx_hash: string | null;
          liquidity: string;
          lp_mint: string | null;
          metadata: Json;
          native_decimals: number | null;
          native_symbol: string;
          opened_tx_hash: string | null;
          owner_address: string | null;
          platform: string | null;
          pool_address: string;
          pool_fee: number;
          position_token_id: string;
          status: string;
          tick_lower: number;
          tick_upper: number;
          token_address: string;
          token_decimals: number | null;
          token_name: string | null;
          token_symbol: string | null;
          uncollected_token_fees_wei: string | null;
          uncollected_weth_fees_wei: string | null;
          updated_at: string;
          user_id: string;
          value_usd: number | null;
          wallet_address: string;
          wallet_id: string | null;
        };
        Insert: {
          amount_native_raw?: string | null;
          amount_token_raw?: string | null;
          amount_token_wei?: string | null;
          amount_weth_wei?: string | null;
          chain?: string;
          closed_tx_hash?: string | null;
          created_at?: string;
          id?: string;
          in_range?: boolean | null;
          last_chain_refresh_at?: string | null;
          last_tx_hash?: string | null;
          liquidity?: string;
          lp_mint?: string | null;
          metadata?: Json;
          native_decimals?: number | null;
          native_symbol?: string;
          opened_tx_hash?: string | null;
          owner_address?: string | null;
          platform?: string | null;
          pool_address: string;
          pool_fee: number;
          position_token_id: string;
          status?: string;
          tick_lower: number;
          tick_upper: number;
          token_address: string;
          token_decimals?: number | null;
          token_name?: string | null;
          token_symbol?: string | null;
          uncollected_token_fees_wei?: string | null;
          uncollected_weth_fees_wei?: string | null;
          updated_at?: string;
          user_id: string;
          value_usd?: number | null;
          wallet_address: string;
          wallet_id?: string | null;
        };
        Update: {
          amount_native_raw?: string | null;
          amount_token_raw?: string | null;
          amount_token_wei?: string | null;
          amount_weth_wei?: string | null;
          chain?: string;
          closed_tx_hash?: string | null;
          created_at?: string;
          id?: string;
          in_range?: boolean | null;
          last_chain_refresh_at?: string | null;
          last_tx_hash?: string | null;
          liquidity?: string;
          lp_mint?: string | null;
          metadata?: Json;
          native_decimals?: number | null;
          native_symbol?: string;
          opened_tx_hash?: string | null;
          owner_address?: string | null;
          platform?: string | null;
          pool_address?: string;
          pool_fee?: number;
          position_token_id?: string;
          status?: string;
          tick_lower?: number;
          tick_upper?: number;
          token_address?: string;
          token_decimals?: number | null;
          token_name?: string | null;
          token_symbol?: string | null;
          uncollected_token_fees_wei?: string | null;
          uncollected_weth_fees_wei?: string | null;
          updated_at?: string;
          user_id?: string;
          value_usd?: number | null;
          wallet_address?: string;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "liquidity_positions_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      market_api_events: {
        Row: {
          cache_status: string | null;
          created_at: string;
          endpoint: string;
          error: string | null;
          http_status: number | null;
          id: string;
          latency_ms: number | null;
          provider: string;
          status: string;
        };
        Insert: {
          cache_status?: string | null;
          created_at?: string;
          endpoint: string;
          error?: string | null;
          http_status?: number | null;
          id?: string;
          latency_ms?: number | null;
          provider: string;
          status: string;
        };
        Update: {
          cache_status?: string | null;
          created_at?: string;
          endpoint?: string;
          error?: string | null;
          http_status?: number | null;
          id?: string;
          latency_ms?: number | null;
          provider?: string;
          status?: string;
        };
        Relationships: [];
      };
      market_discovery_snapshots: {
        Row: {
          chain: string;
          created_at: string;
          expires_at: string;
          fetched_at: string;
          id: string;
          items: Json;
          list_kind: string;
          query: string | null;
          raw_json: Json;
          sort_by: string | null;
          source: string;
        };
        Insert: {
          chain?: string;
          created_at?: string;
          expires_at: string;
          fetched_at?: string;
          id?: string;
          items?: Json;
          list_kind: string;
          query?: string | null;
          raw_json?: Json;
          sort_by?: string | null;
          source: string;
        };
        Update: {
          chain?: string;
          created_at?: string;
          expires_at?: string;
          fetched_at?: string;
          id?: string;
          items?: Json;
          list_kind?: string;
          query?: string | null;
          raw_json?: Json;
          sort_by?: string | null;
          source?: string;
        };
        Relationships: [];
      };
      market_token_snapshots: {
        Row: {
          boosts_active: number | null;
          buyers_24h: number | null;
          buys_1h: number | null;
          buys_24h: number | null;
          buys_5m: number | null;
          buys_6h: number | null;
          chain: string;
          chain_id: number;
          created_at: string;
          expires_at: string;
          explorer_url: string | null;
          fdv_usd: number | null;
          fetched_at: string;
          holders_count: number | null;
          id: string;
          is_verified: boolean | null;
          liquidity_base: number | null;
          liquidity_quote: number | null;
          liquidity_usd: number | null;
          logo_url: string | null;
          market_cap_usd: number | null;
          mint: string | null;
          name: string | null;
          pair_address: string | null;
          pair_created_at: string | null;
          pair_dex_id: string | null;
          pair_url: string | null;
          possible_spam: boolean | null;
          price_change_1h: number | null;
          price_change_24h: number | null;
          price_change_5m: number | null;
          price_change_6h: number | null;
          price_native: string | null;
          price_usd: number | null;
          raw_json: Json;
          score: number | null;
          sellers_24h: number | null;
          sells_1h: number | null;
          sells_24h: number | null;
          sells_5m: number | null;
          sells_6h: number | null;
          source: string;
          symbol: string | null;
          token_address: string | null;
          transfers_count: number | null;
          txns_1h: number | null;
          txns_24h: number | null;
          txns_5m: number | null;
          txns_6h: number | null;
          volume_1h_usd: number | null;
          volume_24h_usd: number | null;
          volume_5m_usd: number | null;
          volume_6h_usd: number | null;
        };
        Insert: {
          boosts_active?: number | null;
          buyers_24h?: number | null;
          buys_1h?: number | null;
          buys_24h?: number | null;
          buys_5m?: number | null;
          buys_6h?: number | null;
          chain?: string;
          chain_id?: number;
          created_at?: string;
          expires_at: string;
          explorer_url?: string | null;
          fdv_usd?: number | null;
          fetched_at?: string;
          holders_count?: number | null;
          id?: string;
          is_verified?: boolean | null;
          liquidity_base?: number | null;
          liquidity_quote?: number | null;
          liquidity_usd?: number | null;
          logo_url?: string | null;
          market_cap_usd?: number | null;
          mint?: string | null;
          name?: string | null;
          pair_address?: string | null;
          pair_created_at?: string | null;
          pair_dex_id?: string | null;
          pair_url?: string | null;
          possible_spam?: boolean | null;
          price_change_1h?: number | null;
          price_change_24h?: number | null;
          price_change_5m?: number | null;
          price_change_6h?: number | null;
          price_native?: string | null;
          price_usd?: number | null;
          raw_json?: Json;
          score?: number | null;
          sellers_24h?: number | null;
          sells_1h?: number | null;
          sells_24h?: number | null;
          sells_5m?: number | null;
          sells_6h?: number | null;
          source: string;
          symbol?: string | null;
          token_address?: string | null;
          transfers_count?: number | null;
          txns_1h?: number | null;
          txns_24h?: number | null;
          txns_5m?: number | null;
          txns_6h?: number | null;
          volume_1h_usd?: number | null;
          volume_24h_usd?: number | null;
          volume_5m_usd?: number | null;
          volume_6h_usd?: number | null;
        };
        Update: {
          boosts_active?: number | null;
          buyers_24h?: number | null;
          buys_1h?: number | null;
          buys_24h?: number | null;
          buys_5m?: number | null;
          buys_6h?: number | null;
          chain?: string;
          chain_id?: number;
          created_at?: string;
          expires_at?: string;
          explorer_url?: string | null;
          fdv_usd?: number | null;
          fetched_at?: string;
          holders_count?: number | null;
          id?: string;
          is_verified?: boolean | null;
          liquidity_base?: number | null;
          liquidity_quote?: number | null;
          liquidity_usd?: number | null;
          logo_url?: string | null;
          market_cap_usd?: number | null;
          mint?: string | null;
          name?: string | null;
          pair_address?: string | null;
          pair_created_at?: string | null;
          pair_dex_id?: string | null;
          pair_url?: string | null;
          possible_spam?: boolean | null;
          price_change_1h?: number | null;
          price_change_24h?: number | null;
          price_change_5m?: number | null;
          price_change_6h?: number | null;
          price_native?: string | null;
          price_usd?: number | null;
          raw_json?: Json;
          score?: number | null;
          sellers_24h?: number | null;
          sells_1h?: number | null;
          sells_24h?: number | null;
          sells_5m?: number | null;
          sells_6h?: number | null;
          source?: string;
          symbol?: string | null;
          token_address?: string | null;
          transfers_count?: number | null;
          txns_1h?: number | null;
          txns_24h?: number | null;
          txns_5m?: number | null;
          txns_6h?: number | null;
          volume_1h_usd?: number | null;
          volume_24h_usd?: number | null;
          volume_5m_usd?: number | null;
          volume_6h_usd?: number | null;
        };
        Relationships: [];
      };
      native_price_cache: {
        Row: {
          chain_id: number;
          fetched_at: string;
          price_usd: number;
          source: string | null;
          symbol: string;
        };
        Insert: {
          chain_id: number;
          fetched_at?: string;
          price_usd: number;
          source?: string | null;
          symbol: string;
        };
        Update: {
          chain_id?: number;
          fetched_at?: string;
          price_usd?: number;
          source?: string | null;
          symbol?: string;
        };
        Relationships: [];
      };
      nft_collection_comment_likes: {
        Row: {
          comment_id: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nft_collection_comment_likes_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "nft_collection_comments";
            referencedColumns: ["id"];
          },
        ];
      };
      nft_collection_comments: {
        Row: {
          body: string;
          collection_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          like_count: number;
          parent_id: string | null;
          reply_count: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          collection_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          like_count?: number;
          parent_id?: string | null;
          reply_count?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          collection_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          like_count?: number;
          parent_id?: string | null;
          reply_count?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nft_collection_comments_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "nft_collections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nft_collection_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "nft_collection_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nft_collection_comments_user_id_fkey_profile";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      nft_collections: {
        Row: {
          created_at: string;
          description: string | null;
          error: string | null;
          explorer_url: string | null;
          id: string;
          image_url: string;
          metadata_uri: string | null;
          mint_address: string | null;
          name: string;
          signature: string | null;
          source_tweet_id: string | null;
          status: string;
          symbol: string;
          telegram_url: string | null;
          twitter_url: string | null;
          updated_at: string;
          user_id: string;
          wallet_id: string;
          website_url: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          error?: string | null;
          explorer_url?: string | null;
          id?: string;
          image_url: string;
          metadata_uri?: string | null;
          mint_address?: string | null;
          name: string;
          signature?: string | null;
          source_tweet_id?: string | null;
          status?: string;
          symbol?: string;
          telegram_url?: string | null;
          twitter_url?: string | null;
          updated_at?: string;
          user_id: string;
          wallet_id: string;
          website_url?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          error?: string | null;
          explorer_url?: string | null;
          id?: string;
          image_url?: string;
          metadata_uri?: string | null;
          mint_address?: string | null;
          name?: string;
          signature?: string | null;
          source_tweet_id?: string | null;
          status?: string;
          symbol?: string;
          telegram_url?: string | null;
          twitter_url?: string | null;
          updated_at?: string;
          user_id?: string;
          wallet_id?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      nft_mints: {
        Row: {
          collection_id: string;
          created_at: string;
          error: string | null;
          explorer_url: string | null;
          id: string;
          image_source: string | null;
          image_url: string;
          metadata_uri: string | null;
          mint_address: string | null;
          name: string;
          signature: string | null;
          source_tweet_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
          wallet_id: string;
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          error?: string | null;
          explorer_url?: string | null;
          id?: string;
          image_source?: string | null;
          image_url: string;
          metadata_uri?: string | null;
          mint_address?: string | null;
          name: string;
          signature?: string | null;
          source_tweet_id?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
          wallet_id: string;
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          error?: string | null;
          explorer_url?: string | null;
          id?: string;
          image_source?: string | null;
          image_url?: string;
          metadata_uri?: string | null;
          mint_address?: string | null;
          name?: string;
          signature?: string | null;
          source_tweet_id?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nft_mints_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "nft_collections";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_actions: {
        Row: {
          action_payload: Json;
          cancelled_at: string | null;
          confirmation_phrase: string;
          confirmed_at: string | null;
          created_at: string;
          executed_at: string | null;
          expires_at: string;
          id: string;
          idempotency_key: string | null;
          intent: string;
          settings_snapshot: Json | null;
          source_surface: string;
          status: string;
          tweet_id: string | null;
          user_id: string;
        };
        Insert: {
          action_payload: Json;
          cancelled_at?: string | null;
          confirmation_phrase: string;
          confirmed_at?: string | null;
          created_at?: string;
          executed_at?: string | null;
          expires_at: string;
          id?: string;
          idempotency_key?: string | null;
          intent: string;
          settings_snapshot?: Json | null;
          source_surface?: string;
          status?: string;
          tweet_id?: string | null;
          user_id: string;
        };
        Update: {
          action_payload?: Json;
          cancelled_at?: string | null;
          confirmation_phrase?: string;
          confirmed_at?: string | null;
          created_at?: string;
          executed_at?: string | null;
          expires_at?: string;
          id?: string;
          idempotency_key?: string | null;
          intent?: string;
          settings_snapshot?: Json | null;
          source_surface?: string;
          status?: string;
          tweet_id?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          auto_provisioned_at: string | null;
          created_at: string;
          dashboard_theme: string;
          default_dev_buy_eth: number;
          default_dev_buy_sol: number;
          default_rules_initialized_at: string | null;
          default_slippage_bps: number;
          id: string;
          max_auto_buy_eth: number | null;
          max_auto_buy_sol: number;
          max_auto_dev_buy_eth: number | null;
          max_auto_dev_buy_sol: number;
          max_auto_sell_percent: number;
          max_auto_transfer_eth: number | null;
          max_auto_transfer_sol: number;
          max_auto_transfer_usdc: number;
          profile_completed: boolean;
          provisioned_source: string | null;
          require_confirmation_for_all_tx: boolean;
          solana_priority_fee_lamports: number;
          terms_accepted_at: string | null;
          terms_accepted_version: string | null;
          twitter_id: string | null;
          twitter_name: string | null;
          twitter_profile_image_url: string | null;
          twitter_username: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          auto_provisioned_at?: string | null;
          created_at?: string;
          dashboard_theme?: string;
          default_dev_buy_eth?: number;
          default_dev_buy_sol?: number;
          default_rules_initialized_at?: string | null;
          default_slippage_bps?: number;
          id?: string;
          max_auto_buy_eth?: number | null;
          max_auto_buy_sol?: number;
          max_auto_dev_buy_eth?: number | null;
          max_auto_dev_buy_sol?: number;
          max_auto_sell_percent?: number;
          max_auto_transfer_eth?: number | null;
          max_auto_transfer_sol?: number;
          max_auto_transfer_usdc?: number;
          profile_completed?: boolean;
          provisioned_source?: string | null;
          require_confirmation_for_all_tx?: boolean;
          solana_priority_fee_lamports?: number;
          terms_accepted_at?: string | null;
          terms_accepted_version?: string | null;
          twitter_id?: string | null;
          twitter_name?: string | null;
          twitter_profile_image_url?: string | null;
          twitter_username?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          auto_provisioned_at?: string | null;
          created_at?: string;
          dashboard_theme?: string;
          default_dev_buy_eth?: number;
          default_dev_buy_sol?: number;
          default_rules_initialized_at?: string | null;
          default_slippage_bps?: number;
          id?: string;
          max_auto_buy_eth?: number | null;
          max_auto_buy_sol?: number;
          max_auto_dev_buy_eth?: number | null;
          max_auto_dev_buy_sol?: number;
          max_auto_sell_percent?: number;
          max_auto_transfer_eth?: number | null;
          max_auto_transfer_sol?: number;
          max_auto_transfer_usdc?: number;
          profile_completed?: boolean;
          provisioned_source?: string | null;
          require_confirmation_for_all_tx?: boolean;
          solana_priority_fee_lamports?: number;
          terms_accepted_at?: string | null;
          terms_accepted_version?: string | null;
          twitter_id?: string | null;
          twitter_name?: string | null;
          twitter_profile_image_url?: string | null;
          twitter_username?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      public_achievements: {
        Row: {
          achieved_at: string;
          detail: string | null;
          id: string;
          kind: string;
          metadata: Json | null;
          metric_value: number | null;
          threshold: number | null;
          title: string;
        };
        Insert: {
          achieved_at?: string;
          detail?: string | null;
          id?: string;
          kind: string;
          metadata?: Json | null;
          metric_value?: number | null;
          threshold?: number | null;
          title: string;
        };
        Update: {
          achieved_at?: string;
          detail?: string | null;
          id?: string;
          kind?: string;
          metadata?: Json | null;
          metric_value?: number | null;
          threshold?: number | null;
          title?: string;
        };
        Relationships: [];
      };
      scheduled_actions: {
        Row: {
          action_payload: Json;
          action_type: string;
          active_occurrence_id: string | null;
          active_occurrence_key: string | null;
          amount_all: boolean;
          amount_eth: number | null;
          amount_original: number | null;
          amount_original_unit: string | null;
          amount_pct: number | null;
          amount_sol: number | null;
          amount_usd: number | null;
          attempt_count: number;
          cancel_reason: string | null;
          cancelled_at: string | null;
          chain: string;
          check_count: number;
          created_at: string;
          ends_at: string | null;
          error: string | null;
          executed_at: string | null;
          execution_result: Json;
          failed_at: string | null;
          failed_occurrence_count: number;
          id: string;
          idempotency_key: string | null;
          interval_seconds: number | null;
          last_checked_at: string | null;
          last_due_at: string | null;
          last_execution_at: string | null;
          last_observed_value_usd: number | null;
          max_attempts: number;
          max_occurrences: number | null;
          next_check_at: string | null;
          occurrence_count: number;
          pending_action_id: string | null;
          paused_at: string | null;
          processed_at: string | null;
          processing_started_at: string | null;
          priority: number;
          recurrence_timezone: string | null;
          recipient: string | null;
          resumed_at: string | null;
          schedule_kind: string;
          scheduled_for: string | null;
          slippage_bps: number | null;
          source: string;
          source_surface: string;
          source_tweet_id: string | null;
          source_tweet_url: string | null;
          status: string;
          starts_at: string | null;
          successful_occurrence_count: number;
          token_address: string | null;
          token_symbol: string | null;
          transaction_hash: string | null;
          transaction_id: string | null;
          transaction_signature: string | null;
          trigger_direction: string | null;
          trigger_metric: string | null;
          trigger_payload: Json;
          trigger_type: string;
          trigger_value_usd: number | null;
          updated_at: string;
          updated_by_user_id: string | null;
          user_id: string;
          worker_id: string | null;
        };
        Insert: {
          action_payload?: Json;
          action_type: string;
          active_occurrence_id?: string | null;
          active_occurrence_key?: string | null;
          amount_all?: boolean;
          amount_eth?: number | null;
          amount_original?: number | null;
          amount_original_unit?: string | null;
          amount_pct?: number | null;
          amount_sol?: number | null;
          amount_usd?: number | null;
          attempt_count?: number;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          chain: string;
          check_count?: number;
          created_at?: string;
          ends_at?: string | null;
          error?: string | null;
          executed_at?: string | null;
          execution_result?: Json;
          failed_at?: string | null;
          failed_occurrence_count?: number;
          id?: string;
          idempotency_key?: string | null;
          interval_seconds?: number | null;
          last_checked_at?: string | null;
          last_due_at?: string | null;
          last_execution_at?: string | null;
          last_observed_value_usd?: number | null;
          max_attempts?: number;
          max_occurrences?: number | null;
          next_check_at?: string | null;
          occurrence_count?: number;
          pending_action_id?: string | null;
          paused_at?: string | null;
          processed_at?: string | null;
          processing_started_at?: string | null;
          priority?: number;
          recurrence_timezone?: string | null;
          recipient?: string | null;
          resumed_at?: string | null;
          schedule_kind?: string;
          scheduled_for?: string | null;
          slippage_bps?: number | null;
          source?: string;
          source_surface?: string;
          source_tweet_id?: string | null;
          source_tweet_url?: string | null;
          status?: string;
          starts_at?: string | null;
          successful_occurrence_count?: number;
          token_address?: string | null;
          token_symbol?: string | null;
          transaction_hash?: string | null;
          transaction_id?: string | null;
          transaction_signature?: string | null;
          trigger_direction?: string | null;
          trigger_metric?: string | null;
          trigger_payload?: Json;
          trigger_type: string;
          trigger_value_usd?: number | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          user_id: string;
          worker_id?: string | null;
        };
        Update: {
          action_payload?: Json;
          action_type?: string;
          active_occurrence_id?: string | null;
          active_occurrence_key?: string | null;
          amount_all?: boolean;
          amount_eth?: number | null;
          amount_original?: number | null;
          amount_original_unit?: string | null;
          amount_pct?: number | null;
          amount_sol?: number | null;
          amount_usd?: number | null;
          attempt_count?: number;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          chain?: string;
          check_count?: number;
          created_at?: string;
          ends_at?: string | null;
          error?: string | null;
          executed_at?: string | null;
          execution_result?: Json;
          failed_at?: string | null;
          failed_occurrence_count?: number;
          id?: string;
          idempotency_key?: string | null;
          interval_seconds?: number | null;
          last_checked_at?: string | null;
          last_due_at?: string | null;
          last_execution_at?: string | null;
          last_observed_value_usd?: number | null;
          max_attempts?: number;
          max_occurrences?: number | null;
          next_check_at?: string | null;
          occurrence_count?: number;
          pending_action_id?: string | null;
          paused_at?: string | null;
          processed_at?: string | null;
          processing_started_at?: string | null;
          priority?: number;
          recurrence_timezone?: string | null;
          recipient?: string | null;
          resumed_at?: string | null;
          schedule_kind?: string;
          scheduled_for?: string | null;
          slippage_bps?: number | null;
          source?: string;
          source_surface?: string;
          source_tweet_id?: string | null;
          source_tweet_url?: string | null;
          status?: string;
          starts_at?: string | null;
          successful_occurrence_count?: number;
          token_address?: string | null;
          token_symbol?: string | null;
          transaction_hash?: string | null;
          transaction_id?: string | null;
          transaction_signature?: string | null;
          trigger_direction?: string | null;
          trigger_metric?: string | null;
          trigger_payload?: Json;
          trigger_type?: string;
          trigger_value_usd?: number | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          user_id?: string;
          worker_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_actions_pending_action_id_fkey";
            columns: ["pending_action_id"];
            isOneToOne: false;
            referencedRelation: "pending_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_actions_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      sol_price_cache: {
        Row: {
          fetched_at: string;
          id: string;
          price_usd: number;
          source: string;
        };
        Insert: {
          fetched_at?: string;
          id?: string;
          price_usd: number;
          source: string;
        };
        Update: {
          fetched_at?: string;
          id?: string;
          price_usd?: number;
          source?: string;
        };
        Relationships: [];
      };
      system_health_events: {
        Row: {
          checked_at: string;
          details: Json | null;
          id: string;
          latency_ms: number | null;
          source: string;
          status: string;
        };
        Insert: {
          checked_at?: string;
          details?: Json | null;
          id?: string;
          latency_ms?: number | null;
          source: string;
          status: string;
        };
        Update: {
          checked_at?: string;
          details?: Json | null;
          id?: string;
          latency_ms?: number | null;
          source?: string;
          status?: string;
        };
        Relationships: [];
      };
      system_health_latest: {
        Row: {
          checked_at: string;
          details: Json;
          last_persisted_at: string | null;
          latency_ms: number | null;
          source: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          checked_at?: string;
          details?: Json;
          last_persisted_at?: string | null;
          latency_ms?: number | null;
          source: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          checked_at?: string;
          details?: Json;
          last_persisted_at?: string | null;
          latency_ms?: number | null;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      telegram_accounts: {
        Row: {
          created_at: string;
          first_name: string | null;
          id: string;
          is_bot: boolean;
          language_code: string | null;
          last_name: string | null;
          linked_at: string | null;
          metadata: Json;
          telegram_user_id: string;
          unlinked_at: string | null;
          updated_at: string;
          user_id: string | null;
          username: string | null;
        };
        Insert: {
          created_at?: string;
          first_name?: string | null;
          id?: string;
          is_bot?: boolean;
          language_code?: string | null;
          last_name?: string | null;
          linked_at?: string | null;
          metadata?: Json;
          telegram_user_id: string;
          unlinked_at?: string | null;
          updated_at?: string;
          user_id?: string | null;
          username?: string | null;
        };
        Update: {
          created_at?: string;
          first_name?: string | null;
          id?: string;
          is_bot?: boolean;
          language_code?: string | null;
          last_name?: string | null;
          linked_at?: string | null;
          metadata?: Json;
          telegram_user_id?: string;
          unlinked_at?: string | null;
          updated_at?: string;
          user_id?: string | null;
          username?: string | null;
        };
        Relationships: [];
      };
      telegram_chats: {
        Row: {
          created_at: string;
          first_name: string | null;
          last_message_at: string | null;
          last_name: string | null;
          metadata: Json;
          telegram_chat_id: string;
          title: string | null;
          type: string;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          created_at?: string;
          first_name?: string | null;
          last_message_at?: string | null;
          last_name?: string | null;
          metadata?: Json;
          telegram_chat_id: string;
          title?: string | null;
          type: string;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          created_at?: string;
          first_name?: string | null;
          last_message_at?: string | null;
          last_name?: string | null;
          metadata?: Json;
          telegram_chat_id?: string;
          title?: string | null;
          type?: string;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      telegram_conversations: {
        Row: {
          chat_type: string;
          created_at: string;
          id: string;
          last_assistant_message_id: string | null;
          last_telegram_message_id: string | null;
          message_thread_id: string;
          surface_conversation_id: string;
          telegram_chat_id: string;
          telegram_user_id: string;
          terminal_conversation_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          chat_type: string;
          created_at?: string;
          id?: string;
          last_assistant_message_id?: string | null;
          last_telegram_message_id?: string | null;
          message_thread_id?: string;
          surface_conversation_id: string;
          telegram_chat_id: string;
          telegram_user_id: string;
          terminal_conversation_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          chat_type?: string;
          created_at?: string;
          id?: string;
          last_assistant_message_id?: string | null;
          last_telegram_message_id?: string | null;
          message_thread_id?: string;
          surface_conversation_id?: string;
          telegram_chat_id?: string;
          telegram_user_id?: string;
          terminal_conversation_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "telegram_conversations_telegram_chat_id_fkey";
            columns: ["telegram_chat_id"];
            isOneToOne: false;
            referencedRelation: "telegram_chats";
            referencedColumns: ["telegram_chat_id"];
          },
          {
            foreignKeyName: "telegram_conversations_telegram_user_id_fkey";
            columns: ["telegram_user_id"];
            isOneToOne: false;
            referencedRelation: "telegram_accounts";
            referencedColumns: ["telegram_user_id"];
          },
          {
            foreignKeyName: "telegram_conversations_terminal_conversation_id_fkey";
            columns: ["terminal_conversation_id"];
            isOneToOne: false;
            referencedRelation: "linkr_terminal_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      telegram_link_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          metadata: Json;
          status: string;
          telegram_chat_id: string;
          telegram_user_id: string;
          token_hash: string;
          updated_at: string;
          used_at: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          metadata?: Json;
          status?: string;
          telegram_chat_id: string;
          telegram_user_id: string;
          token_hash: string;
          updated_at?: string;
          used_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          metadata?: Json;
          status?: string;
          telegram_chat_id?: string;
          telegram_user_id?: string;
          token_hash?: string;
          updated_at?: string;
          used_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_telegram_chat_id_fkey";
            columns: ["telegram_chat_id"];
            isOneToOne: false;
            referencedRelation: "telegram_chats";
            referencedColumns: ["telegram_chat_id"];
          },
          {
            foreignKeyName: "telegram_link_tokens_telegram_user_id_fkey";
            columns: ["telegram_user_id"];
            isOneToOne: false;
            referencedRelation: "telegram_accounts";
            referencedColumns: ["telegram_user_id"];
          },
        ];
      };
      telegram_updates: {
        Row: {
          attempt_count: number;
          created_at: string;
          error: string | null;
          lease_expires_at: string | null;
          payload: Json;
          processed_at: string | null;
          received_at: string;
          status: string;
          telegram_chat_id: string | null;
          telegram_user_id: string | null;
          update_id: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          created_at?: string;
          error?: string | null;
          lease_expires_at?: string | null;
          payload: Json;
          processed_at?: string | null;
          received_at?: string;
          status?: string;
          telegram_chat_id?: string | null;
          telegram_user_id?: string | null;
          update_id: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          error?: string | null;
          lease_expires_at?: string | null;
          payload?: Json;
          processed_at?: string | null;
          received_at?: string;
          status?: string;
          telegram_chat_id?: string | null;
          telegram_user_id?: string | null;
          update_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      telegram_verification_challenges: {
        Row: {
          attempts: number;
          captcha_code: string;
          created_at: string;
          expires_at: string;
          failed_at: string | null;
          id: string;
          invite_link: string | null;
          metadata: Json;
          slider_target: number;
          source: string;
          status: string;
          telegram_chat_id: string;
          telegram_user_id: string;
          token_hash: string;
          updated_at: string;
          verified_at: string | null;
        };
        Insert: {
          attempts?: number;
          captcha_code: string;
          created_at?: string;
          expires_at: string;
          failed_at?: string | null;
          id?: string;
          invite_link?: string | null;
          metadata?: Json;
          slider_target: number;
          source?: string;
          status?: string;
          telegram_chat_id: string;
          telegram_user_id: string;
          token_hash: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          attempts?: number;
          captcha_code?: string;
          created_at?: string;
          expires_at?: string;
          failed_at?: string | null;
          id?: string;
          invite_link?: string | null;
          metadata?: Json;
          slider_target?: number;
          source?: string;
          status?: string;
          telegram_chat_id?: string;
          telegram_user_id?: string;
          token_hash?: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "telegram_verification_challenges_telegram_chat_id_fkey";
            columns: ["telegram_chat_id"];
            isOneToOne: false;
            referencedRelation: "telegram_chats";
            referencedColumns: ["telegram_chat_id"];
          },
          {
            foreignKeyName: "telegram_verification_challenges_telegram_user_id_fkey";
            columns: ["telegram_user_id"];
            isOneToOne: false;
            referencedRelation: "telegram_accounts";
            referencedColumns: ["telegram_user_id"];
          },
        ];
      };
      token_burn_executions: {
        Row: {
          agent_api_key_id: string | null;
          amount_display: string;
          amount_raw: string;
          blockhash: string | null;
          broadcast_at: string | null;
          chain: string;
          confirmed_at: string | null;
          created_at: string;
          decimals: number;
          error_code: string | null;
          id: string;
          idempotency_key: string;
          last_valid_block_height: number | null;
          legacy_pending_action_id: string | null;
          metadata: Json;
          nonce: number | null;
          pending_action_id: string | null;
          signed_transaction: string;
          source_surface: string;
          state: string;
          symbol: string | null;
          token_account_addresses: string[];
          token_address: string;
          tx_hash: string;
          updated_at: string;
          user_id: string;
          wallet_id: string;
        };
        Insert: {
          agent_api_key_id?: string | null;
          amount_display: string;
          amount_raw: string;
          blockhash?: string | null;
          broadcast_at?: string | null;
          chain: string;
          confirmed_at?: string | null;
          created_at?: string;
          decimals: number;
          error_code?: string | null;
          id?: string;
          idempotency_key: string;
          last_valid_block_height?: number | null;
          legacy_pending_action_id?: string | null;
          metadata?: Json;
          nonce?: number | null;
          pending_action_id?: string | null;
          signed_transaction: string;
          source_surface: string;
          state?: string;
          symbol?: string | null;
          token_account_addresses?: string[];
          token_address: string;
          tx_hash: string;
          updated_at?: string;
          user_id: string;
          wallet_id: string;
        };
        Update: {
          agent_api_key_id?: string | null;
          amount_display?: string;
          amount_raw?: string;
          blockhash?: string | null;
          broadcast_at?: string | null;
          chain?: string;
          confirmed_at?: string | null;
          created_at?: string;
          decimals?: number;
          error_code?: string | null;
          id?: string;
          idempotency_key?: string;
          last_valid_block_height?: number | null;
          legacy_pending_action_id?: string | null;
          metadata?: Json;
          nonce?: number | null;
          pending_action_id?: string | null;
          signed_transaction?: string;
          source_surface?: string;
          state?: string;
          symbol?: string | null;
          token_account_addresses?: string[];
          token_address?: string;
          tx_hash?: string;
          updated_at?: string;
          user_id?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "token_burn_executions_agent_api_key_id_fkey";
            columns: ["agent_api_key_id"];
            isOneToOne: false;
            referencedRelation: "agent_api_keys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "token_burn_executions_legacy_pending_action_id_fkey";
            columns: ["legacy_pending_action_id"];
            isOneToOne: false;
            referencedRelation: "pending_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "token_burn_executions_pending_action_id_fkey";
            columns: ["pending_action_id"];
            isOneToOne: false;
            referencedRelation: "linkr_pending_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "token_burn_executions_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      token_registry: {
        Row: {
          chain: string;
          chain_id: number;
          created_at: string;
          decimals: number | null;
          explorer_url: string | null;
          id: string;
          logo_url: string | null;
          mint: string;
          name: string | null;
          possible_spam: boolean;
          raw_metadata: Json | null;
          source: string | null;
          symbol: string | null;
          token_address: string | null;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          chain?: string;
          chain_id?: number;
          created_at?: string;
          decimals?: number | null;
          explorer_url?: string | null;
          id?: string;
          logo_url?: string | null;
          mint: string;
          name?: string | null;
          possible_spam?: boolean;
          raw_metadata?: Json | null;
          source?: string | null;
          symbol?: string | null;
          token_address?: string | null;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          chain?: string;
          chain_id?: number;
          created_at?: string;
          decimals?: number | null;
          explorer_url?: string | null;
          id?: string;
          logo_url?: string | null;
          mint?: string;
          name?: string | null;
          possible_spam?: boolean;
          raw_metadata?: Json | null;
          source?: string | null;
          symbol?: string | null;
          token_address?: string | null;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      token_resolution_aliases: {
        Row: {
          chain: string;
          confidence: number;
          created_at: string;
          id: string;
          mint: string;
          name: string | null;
          raw_json: Json;
          source: string;
          symbol: string | null;
          updated_at: string;
        };
        Insert: {
          chain?: string;
          confidence?: number;
          created_at?: string;
          id?: string;
          mint: string;
          name?: string | null;
          raw_json?: Json;
          source: string;
          symbol?: string | null;
          updated_at?: string;
        };
        Update: {
          chain?: string;
          confidence?: number;
          created_at?: string;
          id?: string;
          mint?: string;
          name?: string | null;
          raw_json?: Json;
          source?: string;
          symbol?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          action: string | null;
          amount_eth: number | null;
          amount_original: number | null;
          amount_original_unit: string | null;
          amount_sol: number | null;
          amount_usd: number | null;
          chain: string | null;
          chain_id: number | null;
          confirmed_at: string | null;
          created_at: string;
          effective_gas_price_wei: string | null;
          error: string | null;
          eth_price_usd: number | null;
          execution_payload: Json | null;
          explorer_url: string | null;
          failed_at: string | null;
          gas_used_wei: string | null;
          id: string;
          idempotency_key: string;
          input_amount_wei: string | null;
          input_mint: string | null;
          input_token_decimals: number | null;
          input_token_symbol: string | null;
          min_output_amount_wei: string | null;
          native_symbol: string | null;
          output_amount_wei: string | null;
          output_mint: string | null;
          output_token_decimals: number | null;
          output_token_symbol: string | null;
          quote_id: string | null;
          quote_payload: Json | null;
          quoted_output_amount_wei: string | null;
          raw_request: Json | null;
          raw_result: Json | null;
          route_source: string | null;
          router_address: string | null;
          slippage_bps: number | null;
          sol_price_usd: number | null;
          source_surface: string;
          status: string | null;
          submitted_at: string | null;
          terminal_conversation_id: string | null;
          terminal_message_id: string | null;
          tweet_id: string | null;
          tx_hash: string | null;
          tx_signature: string | null;
          user_id: string | null;
          wallet_address: string | null;
          wallet_id: string | null;
        };
        Insert: {
          action?: string | null;
          amount_eth?: number | null;
          amount_original?: number | null;
          amount_original_unit?: string | null;
          amount_sol?: number | null;
          amount_usd?: number | null;
          chain?: string | null;
          chain_id?: number | null;
          confirmed_at?: string | null;
          created_at?: string;
          effective_gas_price_wei?: string | null;
          error?: string | null;
          eth_price_usd?: number | null;
          execution_payload?: Json | null;
          explorer_url?: string | null;
          failed_at?: string | null;
          gas_used_wei?: string | null;
          id?: string;
          idempotency_key: string;
          input_amount_wei?: string | null;
          input_mint?: string | null;
          input_token_decimals?: number | null;
          input_token_symbol?: string | null;
          min_output_amount_wei?: string | null;
          native_symbol?: string | null;
          output_amount_wei?: string | null;
          output_mint?: string | null;
          output_token_decimals?: number | null;
          output_token_symbol?: string | null;
          quote_id?: string | null;
          quote_payload?: Json | null;
          quoted_output_amount_wei?: string | null;
          raw_request?: Json | null;
          raw_result?: Json | null;
          route_source?: string | null;
          router_address?: string | null;
          slippage_bps?: number | null;
          sol_price_usd?: number | null;
          source_surface?: string;
          status?: string | null;
          submitted_at?: string | null;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          tweet_id?: string | null;
          tx_hash?: string | null;
          tx_signature?: string | null;
          user_id?: string | null;
          wallet_address?: string | null;
          wallet_id?: string | null;
        };
        Update: {
          action?: string | null;
          amount_eth?: number | null;
          amount_original?: number | null;
          amount_original_unit?: string | null;
          amount_sol?: number | null;
          amount_usd?: number | null;
          chain?: string | null;
          chain_id?: number | null;
          confirmed_at?: string | null;
          created_at?: string;
          effective_gas_price_wei?: string | null;
          error?: string | null;
          eth_price_usd?: number | null;
          execution_payload?: Json | null;
          explorer_url?: string | null;
          failed_at?: string | null;
          gas_used_wei?: string | null;
          id?: string;
          idempotency_key?: string;
          input_amount_wei?: string | null;
          input_mint?: string | null;
          input_token_decimals?: number | null;
          input_token_symbol?: string | null;
          min_output_amount_wei?: string | null;
          native_symbol?: string | null;
          output_amount_wei?: string | null;
          output_mint?: string | null;
          output_token_decimals?: number | null;
          output_token_symbol?: string | null;
          quote_id?: string | null;
          quote_payload?: Json | null;
          quoted_output_amount_wei?: string | null;
          raw_request?: Json | null;
          raw_result?: Json | null;
          route_source?: string | null;
          router_address?: string | null;
          slippage_bps?: number | null;
          sol_price_usd?: number | null;
          source_surface?: string;
          status?: string | null;
          submitted_at?: string | null;
          terminal_conversation_id?: string | null;
          terminal_message_id?: string | null;
          tweet_id?: string | null;
          tx_hash?: string | null;
          tx_signature?: string | null;
          user_id?: string | null;
          wallet_address?: string | null;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      tweet_thread_contexts: {
        Row: {
          context_json: Json;
          created_at: string;
          detected_media_urls: string[];
          detected_mints: string[];
          detected_symbols: string[];
          detected_urls: string[];
          flattened_context: string | null;
          id: string;
          parent_tweet_id: string | null;
          root_tweet_id: string | null;
          tweet_id: string;
        };
        Insert: {
          context_json: Json;
          created_at?: string;
          detected_media_urls?: string[];
          detected_mints?: string[];
          detected_symbols?: string[];
          detected_urls?: string[];
          flattened_context?: string | null;
          id?: string;
          parent_tweet_id?: string | null;
          root_tweet_id?: string | null;
          tweet_id: string;
        };
        Update: {
          context_json?: Json;
          created_at?: string;
          detected_media_urls?: string[];
          detected_mints?: string[];
          detected_symbols?: string[];
          detected_urls?: string[];
          flattened_context?: string | null;
          id?: string;
          parent_tweet_id?: string | null;
          root_tweet_id?: string | null;
          tweet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tweet_thread_contexts_tweet_id_fkey";
            columns: ["tweet_id"];
            isOneToOne: false;
            referencedRelation: "tweets_inbox";
            referencedColumns: ["tweet_id"];
          },
        ];
      };
      tweet_thread_contexts_archive: {
        Row: {
          archived_at: string;
          context_json: Json;
          created_at: string;
          detected_media_urls: string[];
          detected_mints: string[];
          detected_symbols: string[];
          detected_urls: string[];
          flattened_context: string | null;
          id: string;
          parent_tweet_id: string | null;
          root_tweet_id: string | null;
          tweet_id: string;
        };
        Insert: {
          archived_at?: string;
          context_json: Json;
          created_at?: string;
          detected_media_urls?: string[];
          detected_mints?: string[];
          detected_symbols?: string[];
          detected_urls?: string[];
          flattened_context?: string | null;
          id?: string;
          parent_tweet_id?: string | null;
          root_tweet_id?: string | null;
          tweet_id: string;
        };
        Update: {
          archived_at?: string;
          context_json?: Json;
          created_at?: string;
          detected_media_urls?: string[];
          detected_mints?: string[];
          detected_symbols?: string[];
          detected_urls?: string[];
          flattened_context?: string | null;
          id?: string;
          parent_tweet_id?: string | null;
          root_tweet_id?: string | null;
          tweet_id?: string;
        };
        Relationships: [];
      };
      tweets_inbox: {
        Row: {
          ai_processing_lane: string | null;
          ai_route_attempt_count: number;
          ai_route_kind: string | null;
          ai_route_reason: string | null;
          ai_routed_at: string | null;
          attempt_count: number;
          author_twitter_id: string;
          author_username: string | null;
          conversation_id: string | null;
          created_at: string;
          error: string | null;
          has_media: boolean;
          id: string;
          ingest_reason: string | null;
          ingest_source: string | null;
          is_follow_up: boolean;
          last_attempt_at: string | null;
          media_url: string | null;
          next_attempt_at: string | null;
          parent_inbox_tweet_id: string | null;
          parent_reply_tweet_id: string | null;
          parent_tweet_id: string | null;
          processed_at: string | null;
          queue_generation: number;
          referenced_tweet_id: string | null;
          root_tweet_id: string | null;
          status: string;
          text: string;
          tweet_id: string;
          tweet_url: string | null;
          work_item_id: string | null;
        };
        Insert: {
          ai_processing_lane?: string | null;
          ai_route_attempt_count?: number;
          ai_route_kind?: string | null;
          ai_route_reason?: string | null;
          ai_routed_at?: string | null;
          attempt_count?: number;
          author_twitter_id: string;
          author_username?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          has_media?: boolean;
          id?: string;
          ingest_reason?: string | null;
          ingest_source?: string | null;
          is_follow_up?: boolean;
          last_attempt_at?: string | null;
          media_url?: string | null;
          next_attempt_at?: string | null;
          parent_inbox_tweet_id?: string | null;
          parent_reply_tweet_id?: string | null;
          parent_tweet_id?: string | null;
          processed_at?: string | null;
          queue_generation?: number;
          referenced_tweet_id?: string | null;
          root_tweet_id?: string | null;
          status?: string;
          text: string;
          tweet_id: string;
          tweet_url?: string | null;
          work_item_id?: string | null;
        };
        Update: {
          ai_processing_lane?: string | null;
          ai_route_attempt_count?: number;
          ai_route_kind?: string | null;
          ai_route_reason?: string | null;
          ai_routed_at?: string | null;
          attempt_count?: number;
          author_twitter_id?: string;
          author_username?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          has_media?: boolean;
          id?: string;
          ingest_reason?: string | null;
          ingest_source?: string | null;
          is_follow_up?: boolean;
          last_attempt_at?: string | null;
          media_url?: string | null;
          next_attempt_at?: string | null;
          parent_inbox_tweet_id?: string | null;
          parent_reply_tweet_id?: string | null;
          parent_tweet_id?: string | null;
          processed_at?: string | null;
          queue_generation?: number;
          referenced_tweet_id?: string | null;
          root_tweet_id?: string | null;
          status?: string;
          text?: string;
          tweet_id?: string;
          tweet_url?: string | null;
          work_item_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tweets_inbox_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      tweets_inbox_archive: {
        Row: {
          archived_at: string;
          attempt_count: number;
          author_twitter_id: string;
          author_username: string | null;
          conversation_id: string | null;
          created_at: string;
          error: string | null;
          has_media: boolean;
          id: string;
          ingest_reason: string | null;
          ingest_source: string | null;
          is_follow_up: boolean;
          last_attempt_at: string | null;
          media_url: string | null;
          next_attempt_at: string | null;
          parent_inbox_tweet_id: string | null;
          parent_reply_tweet_id: string | null;
          parent_tweet_id: string | null;
          processed_at: string | null;
          referenced_tweet_id: string | null;
          root_tweet_id: string | null;
          status: string;
          text: string;
          tweet_id: string;
          tweet_url: string | null;
        };
        Insert: {
          archived_at?: string;
          attempt_count?: number;
          author_twitter_id: string;
          author_username?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          has_media?: boolean;
          id?: string;
          ingest_reason?: string | null;
          ingest_source?: string | null;
          is_follow_up?: boolean;
          last_attempt_at?: string | null;
          media_url?: string | null;
          next_attempt_at?: string | null;
          parent_inbox_tweet_id?: string | null;
          parent_reply_tweet_id?: string | null;
          parent_tweet_id?: string | null;
          processed_at?: string | null;
          referenced_tweet_id?: string | null;
          root_tweet_id?: string | null;
          status?: string;
          text: string;
          tweet_id: string;
          tweet_url?: string | null;
        };
        Update: {
          archived_at?: string;
          attempt_count?: number;
          author_twitter_id?: string;
          author_username?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          has_media?: boolean;
          id?: string;
          ingest_reason?: string | null;
          ingest_source?: string | null;
          is_follow_up?: boolean;
          last_attempt_at?: string | null;
          media_url?: string | null;
          next_attempt_at?: string | null;
          parent_inbox_tweet_id?: string | null;
          parent_reply_tweet_id?: string | null;
          parent_tweet_id?: string | null;
          processed_at?: string | null;
          referenced_tweet_id?: string | null;
          root_tweet_id?: string | null;
          status?: string;
          text?: string;
          tweet_id?: string;
          tweet_url?: string | null;
        };
        Relationships: [];
      };
      twitter_replies: {
        Row: {
          attempt_count: number;
          author_twitter_id: string | null;
          conversation_id: string | null;
          created_at: string;
          delivery_lane: string;
          error: string | null;
          error_details: Json;
          id: string;
          idempotency_key: string | null;
          last_attempt_at: string | null;
          last_status_code: number | null;
          lint_result: Json | null;
          next_attempt_at: string | null;
          posted_at: string | null;
          prompt_version: string | null;
          reply_kind: string | null;
          reply_text: string;
          reply_tweet_id: string | null;
          status: string;
          tweet_id: string | null;
          work_item_id: string | null;
        };
        Insert: {
          attempt_count?: number;
          author_twitter_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          delivery_lane?: string;
          error?: string | null;
          error_details?: Json;
          id?: string;
          idempotency_key?: string | null;
          last_attempt_at?: string | null;
          last_status_code?: number | null;
          lint_result?: Json | null;
          next_attempt_at?: string | null;
          posted_at?: string | null;
          prompt_version?: string | null;
          reply_kind?: string | null;
          reply_text: string;
          reply_tweet_id?: string | null;
          status?: string;
          tweet_id?: string | null;
          work_item_id?: string | null;
        };
        Update: {
          attempt_count?: number;
          author_twitter_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          delivery_lane?: string;
          error?: string | null;
          error_details?: Json;
          id?: string;
          idempotency_key?: string | null;
          last_attempt_at?: string | null;
          last_status_code?: number | null;
          lint_result?: Json | null;
          next_attempt_at?: string | null;
          posted_at?: string | null;
          prompt_version?: string | null;
          reply_kind?: string | null;
          reply_text?: string;
          reply_tweet_id?: string | null;
          status?: string;
          tweet_id?: string | null;
          work_item_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "twitter_replies_work_item_id_fkey";
            columns: ["work_item_id"];
            isOneToOne: false;
            referencedRelation: "linkr_work_items";
            referencedColumns: ["id"];
          },
        ];
      };
      twitter_replies_archive: {
        Row: {
          archived_at: string;
          attempt_count: number;
          author_twitter_id: string | null;
          conversation_id: string | null;
          created_at: string;
          error: string | null;
          error_details: Json;
          id: string;
          idempotency_key: string | null;
          last_attempt_at: string | null;
          last_status_code: number | null;
          lint_result: Json | null;
          next_attempt_at: string | null;
          posted_at: string | null;
          prompt_version: string | null;
          reply_kind: string | null;
          reply_text: string;
          reply_tweet_id: string | null;
          status: string;
          tweet_id: string | null;
        };
        Insert: {
          archived_at?: string;
          attempt_count?: number;
          author_twitter_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          error_details?: Json;
          id?: string;
          idempotency_key?: string | null;
          last_attempt_at?: string | null;
          last_status_code?: number | null;
          lint_result?: Json | null;
          next_attempt_at?: string | null;
          posted_at?: string | null;
          prompt_version?: string | null;
          reply_kind?: string | null;
          reply_text: string;
          reply_tweet_id?: string | null;
          status?: string;
          tweet_id?: string | null;
        };
        Update: {
          archived_at?: string;
          attempt_count?: number;
          author_twitter_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          error_details?: Json;
          id?: string;
          idempotency_key?: string | null;
          last_attempt_at?: string | null;
          last_status_code?: number | null;
          lint_result?: Json | null;
          next_attempt_at?: string | null;
          posted_at?: string | null;
          prompt_version?: string | null;
          reply_kind?: string | null;
          reply_text?: string;
          reply_tweet_id?: string | null;
          status?: string;
          tweet_id?: string | null;
        };
        Relationships: [];
      };
      user_memory_index: {
        Row: {
          created_at: string;
          id: string;
          metadata: Json | null;
          searchable_text: string;
          source_id: string;
          source_type: string;
          title: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          searchable_text: string;
          source_id: string;
          source_type: string;
          title?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          searchable_text?: string;
          source_id?: string;
          source_type?: string;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_memory_index_archive: {
        Row: {
          archived_at: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          searchable_text: string;
          source_id: string;
          source_type: string;
          title: string | null;
          user_id: string;
        };
        Insert: {
          archived_at?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          searchable_text: string;
          source_id: string;
          source_type: string;
          title?: string | null;
          user_id: string;
        };
        Update: {
          archived_at?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          searchable_text?: string;
          source_id?: string;
          source_type?: string;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_transfer_requests: {
        Row: {
          amount_text: string;
          asset: string;
          chain: string;
          created_at: string;
          explicit_idempotency: boolean;
          guard_key: string;
          id: string;
          recipient: string;
          response: Json | null;
          status: string;
          tx_hash: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_text: string;
          asset: string;
          chain: string;
          created_at?: string;
          explicit_idempotency?: boolean;
          guard_key: string;
          id?: string;
          recipient: string;
          response?: Json | null;
          status?: string;
          tx_hash?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount_text?: string;
          asset?: string;
          chain?: string;
          created_at?: string;
          explicit_idempotency?: boolean;
          guard_key?: string;
          id?: string;
          recipient?: string;
          response?: Json | null;
          status?: string;
          tx_hash?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_export_challenges: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          session_hash: string | null;
          status: string;
          token_hash: string;
          used_at: string | null;
          user_id: string;
          wallet_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          session_hash?: string | null;
          status?: string;
          token_hash: string;
          used_at?: string | null;
          user_id: string;
          wallet_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          session_hash?: string | null;
          status?: string;
          token_hash?: string;
          used_at?: string | null;
          user_id?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_export_challenges_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      wallet_funding_events: {
        Row: {
          amount_wei: string;
          broadcast_attempt_count: number;
          chain: string | null;
          coin_launch_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          destination_address: string;
          error: string | null;
          funding_kind: string;
          id: string;
          last_broadcast_at: string | null;
          last_valid_block_height: number | null;
          raw_result: Json;
          recent_blockhash: string | null;
          signed_transaction_base64: string | null;
          signed_transaction_hash: string | null;
          source_address: string | null;
          status: string;
          tx_hash: string | null;
          updated_at: string;
          user_id: string | null;
          wallet_id: string | null;
        };
        Insert: {
          amount_wei: string;
          broadcast_attempt_count?: number;
          chain?: string | null;
          coin_launch_id?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          destination_address: string;
          error?: string | null;
          funding_kind?: string;
          id?: string;
          last_broadcast_at?: string | null;
          last_valid_block_height?: number | null;
          raw_result?: Json;
          recent_blockhash?: string | null;
          signed_transaction_base64?: string | null;
          signed_transaction_hash?: string | null;
          source_address?: string | null;
          status?: string;
          tx_hash?: string | null;
          updated_at?: string;
          user_id?: string | null;
          wallet_id?: string | null;
        };
        Update: {
          amount_wei?: string;
          broadcast_attempt_count?: number;
          chain?: string | null;
          coin_launch_id?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          destination_address?: string;
          error?: string | null;
          funding_kind?: string;
          id?: string;
          last_broadcast_at?: string | null;
          last_valid_block_height?: number | null;
          raw_result?: Json;
          recent_blockhash?: string | null;
          signed_transaction_base64?: string | null;
          signed_transaction_hash?: string | null;
          source_address?: string | null;
          status?: string;
          tx_hash?: string | null;
          updated_at?: string;
          user_id?: string | null;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_funding_events_coin_launch_id_fkey";
            columns: ["coin_launch_id"];
            isOneToOne: false;
            referencedRelation: "coin_launches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallet_funding_events_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      wallet_security_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: number;
          metadata: Json;
          outcome: string;
          request_ip: string | null;
          user_agent: string | null;
          user_id: string | null;
          wallet_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: number;
          metadata?: Json;
          outcome: string;
          request_ip?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
          wallet_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: number;
          metadata?: Json;
          outcome?: string;
          request_ip?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_security_events_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      wallets: {
        Row: {
          address: string | null;
          chain_id: number | null;
          created_at: string;
          encrypted_private_key: string;
          encryption_auth_tag: string;
          encryption_iv: string;
          explorer_url: string | null;
          id: string;
          is_primary: boolean;
          public_key: string;
          user_id: string;
          wallet_type: string;
        };
        Insert: {
          address?: string | null;
          chain_id?: number | null;
          created_at?: string;
          encrypted_private_key: string;
          encryption_auth_tag: string;
          encryption_iv: string;
          explorer_url?: string | null;
          id?: string;
          is_primary?: boolean;
          public_key: string;
          user_id: string;
          wallet_type?: string;
        };
        Update: {
          address?: string | null;
          chain_id?: number | null;
          created_at?: string;
          encrypted_private_key?: string;
          encryption_auth_tag?: string;
          encryption_iv?: string;
          explorer_url?: string | null;
          id?: string;
          is_primary?: boolean;
          public_key?: string;
          user_id?: string;
          wallet_type?: string;
        };
        Relationships: [];
      };
      x_bot_token_events: {
        Row: {
          account_key: string;
          created_at: string;
          details: Json;
          event_type: string;
          id: number;
          message: string | null;
          status: string;
        };
        Insert: {
          account_key?: string;
          created_at?: string;
          details?: Json;
          event_type: string;
          id?: number;
          message?: string | null;
          status: string;
        };
        Update: {
          account_key?: string;
          created_at?: string;
          details?: Json;
          event_type?: string;
          id?: number;
          message?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      x_bot_tokens: {
        Row: {
          access_token_auth_tag: string;
          access_token_ciphertext: string;
          access_token_iv: string;
          account_key: string;
          bot_handle: string;
          created_at: string;
          expires_at: string;
          id: string;
          is_active: boolean;
          last_error: string | null;
          last_refresh_attempt_at: string | null;
          last_refresh_status: string | null;
          last_refreshed_at: string | null;
          refresh_lock_owner: string | null;
          refresh_lock_until: string | null;
          refresh_token_auth_tag: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          scope: string;
          token_type: string;
          updated_at: string;
          x_user_id: string | null;
        };
        Insert: {
          access_token_auth_tag: string;
          access_token_ciphertext: string;
          access_token_iv: string;
          account_key?: string;
          bot_handle?: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          is_active?: boolean;
          last_error?: string | null;
          last_refresh_attempt_at?: string | null;
          last_refresh_status?: string | null;
          last_refreshed_at?: string | null;
          refresh_lock_owner?: string | null;
          refresh_lock_until?: string | null;
          refresh_token_auth_tag: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          scope: string;
          token_type?: string;
          updated_at?: string;
          x_user_id?: string | null;
        };
        Update: {
          access_token_auth_tag?: string;
          access_token_ciphertext?: string;
          access_token_iv?: string;
          account_key?: string;
          bot_handle?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          is_active?: boolean;
          last_error?: string | null;
          last_refresh_attempt_at?: string | null;
          last_refresh_status?: string | null;
          last_refreshed_at?: string | null;
          refresh_lock_owner?: string | null;
          refresh_lock_until?: string | null;
          refresh_token_auth_tag?: string;
          refresh_token_ciphertext?: string;
          refresh_token_iv?: string;
          scope?: string;
          token_type?: string;
          updated_at?: string;
          x_user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      linkr_pipeline_latency_v1: {
        Row: {
          max_seconds: number | null;
          p50_seconds: number | null;
          p95_seconds: number | null;
          request_type: string | null;
          route: string | null;
          samples: number | null;
        };
        Relationships: [];
      };
      public_activity_feed: {
        Row: {
          amount_eth: number | null;
          amount_sol: number | null;
          amount_usd: number | null;
          chain: string | null;
          created_at: string | null;
          detail: string | null;
          id: string | null;
          kind: string | null;
          launch_platform: string | null;
          linkr_response_status: string | null;
          linkr_response_text: string | null;
          linkr_response_tweet_id: string | null;
          native_symbol: string | null;
          reference: string | null;
          status: string | null;
          title: string | null;
          tweet_id: string | null;
          tx_hash: string | null;
          user_post_author: string | null;
          user_post_text: string | null;
          user_post_url: string | null;
        };
        Relationships: [];
      };
      public_activity_profiles: {
        Row: {
          avatar_url: string | null;
          display_name: string | null;
          handle: string | null;
          handle_key: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_legacy_telegram_update: {
        Args: {
          p_lease_seconds?: number;
          p_payload: Json;
          p_telegram_chat_id: string;
          p_telegram_user_id: string;
          p_update_id: string;
        };
        Returns: Json;
      };
      accept_linkr_launch_request_v1: {
        Args: {
          p_chain: string;
          p_idempotency_key: string;
          p_payload: Json;
          p_pending_action_id?: string;
          p_source_event_id: string;
          p_source_surface: string;
          p_user_id: string;
          p_wallet_id: string;
        };
        Returns: Json;
      };
      accept_linkr_work_item: {
        Args: {
          p_consumer_version?: string;
          p_conversation_id: string;
          p_execution_generation?: number;
          p_idempotency_key: string;
          p_payload?: Json;
          p_payload_hash?: string;
          p_payload_ref?: string;
          p_priority?: number;
          p_request_type: string;
          p_resource_key?: string;
          p_resource_type?: string;
          p_route: string;
          p_source_event_id: string;
          p_source_surface: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      accept_linkr_x_page_v1: {
        Args: { p_execution_generation?: number; p_tweet_ids: Json };
        Returns: Json;
      };
      accept_shadow_x_page: { Args: { p_tweet_ids: Json }; Returns: Json };
      acquire_linkr_agent_lock: {
        Args: {
          p_expires_at: string;
          p_lock_key: string;
          p_owner_id: string;
          p_run_id: string;
          p_scope_id: string;
          p_scope_type: string;
          p_surface: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      action_source_surface_from_row: {
        Args: { p_fallback?: string; p_row: Json };
        Returns: string;
      };
      activate_linkr_authorized_launch_v1: {
        Args: {
          p_authorization_kind: string;
          p_confirmation_work_item_id?: string;
          p_pending_action_id: string;
        };
        Returns: Json;
      };
      archive_operational_history: {
        Args: {
          p_agent_runs_days?: number;
          p_archive_retention_days?: number;
          p_batch_size?: number;
          p_max_rows_per_table?: number;
          p_memory_days?: number;
          p_replies_days?: number;
          p_tweets_days?: number;
        };
        Returns: Json;
      };
      authorize_linkr_launch_v2: {
        Args: {
          p_draft_id: string;
          p_image_content_type: string;
          p_image_height: number;
          p_image_sha256: string;
          p_image_url: string;
          p_image_width: number;
          p_original_image_url: string;
          p_payload: Json;
          p_preparation_work_item_id: string;
          p_storage_path: string;
          p_wallet_id: string;
        };
        Returns: Json;
      };
      cancel_linkr_launch_action_v1: {
        Args: {
          p_cancellation_work_item_id: string;
          p_pending_action_id: string;
        };
        Returns: Json;
      };
      claim_cron_lock: {
        Args: { p_lock_name: string; p_owner: string; p_ttl_seconds?: number };
        Returns: boolean;
      };
      claim_linkr_stage_work: {
        Args: {
          p_batch_quantity?: number;
          p_queue_name: string;
          p_visibility_seconds: number;
          p_worker_id: string;
        };
        Returns: Json;
      };
      claim_next_queued_coin_launch: {
        Args: { p_stale_before?: string; p_worker_id: string };
        Returns: {
          action_ordinal: number;
          attempt_count: number;
          chain: string | null;
          chain_id: number | null;
          created_at: string;
          creator_rewards_config: Json | null;
          deployer: string | null;
          description: string | null;
          dev_buy_eth: number | null;
          dev_buy_original_amount: number | null;
          dev_buy_original_unit: string | null;
          dev_buy_sol: number | null;
          dev_buy_usd: number | null;
          dex_factory: string | null;
          effective_initial_buy_eth: number | null;
          effective_initial_buy_lamports: string | null;
          effective_initial_buy_wei: string | null;
          error: string | null;
          eth_price_usd: number | null;
          explorer_url: string | null;
          factory: string | null;
          fee_recipient_kind: string | null;
          fee_recipient_twitter_username: string | null;
          fee_wallet: string | null;
          fee_wallet_user_id: string | null;
          filebase_image_object_key: string | null;
          filebase_metadata_object_key: string | null;
          first_launch_subsidized: boolean;
          first_launch_subsidy_eligible: boolean;
          funding_amount_wei: string | null;
          funding_error: string | null;
          funding_policy: string | null;
          funding_status: string | null;
          funding_tx_hash: string | null;
          graduation_weth_wei: string | null;
          id: string;
          idempotency_key: string | null;
          image_url: string | null;
          initial_buy_amount_wei: string | null;
          initial_buy_policy: string | null;
          initial_buy_tokens_out_wei: string | null;
          ipfs_image_cid: string | null;
          ipfs_image_gateway_url: string | null;
          ipfs_image_uri: string | null;
          ipfs_metadata_cid: string | null;
          ipfs_metadata_gateway_url: string | null;
          ipfs_metadata_uri: string | null;
          is_token0: boolean | null;
          last_attempt_at: string | null;
          launch_fee_wei: string | null;
          launch_metadata: Json | null;
          launch_method: string | null;
          launch_origin: string | null;
          launch_platform: string | null;
          launch_signer_address: string | null;
          launch_signer_wallet_id: string | null;
          launch_source: string;
          lp_dust_wei: string | null;
          lp_liquidity: string | null;
          lp_sqrt_price_x96: string | null;
          lp_tick_lower: string | null;
          lp_tick_upper: string | null;
          lp_used_launch_wei: string | null;
          max_attempts: number;
          mayhem_mode_requested: boolean | null;
          metadata_storage_error: string | null;
          metadata_storage_provider: string | null;
          metadata_telegram_url: string | null;
          metadata_twitter_url: string | null;
          metadata_uri: string | null;
          metadata_website_url: string | null;
          mint: string | null;
          name: string;
          next_attempt_at: string | null;
          noxa_receipt: Json | null;
          noxa_verified: Json | null;
          original_image_url: string | null;
          pair_token: string | null;
          paired_token: string | null;
          pool: string | null;
          pool_fee: number | null;
          position_id: string | null;
          position_manager: string | null;
          processed_at: string | null;
          processing_started_at: string | null;
          pump_metadata_uri: string | null;
          pump_receipt: Json | null;
          pump_url: string | null;
          requested_initial_buy_eth: number | null;
          requested_initial_buy_lamports: string | null;
          requested_initial_buy_wei: string | null;
          restrictions_end_block: string | null;
          single_sided_launch_receipt: Json | null;
          single_sided_launch_record: Json | null;
          sol_price_usd: number | null;
          solana_launch_wallet_address: string | null;
          solana_launch_wallet_id: string | null;
          solscan_url: string | null;
          source_surface: string;
          source_tweet_id: string | null;
          source_tweet_url: string | null;
          stable_logo_url: string | null;
          status: string;
          symbol: string;
          telegram_group_announced_at: string | null;
          telegram_group_announcement_attempted_at: string | null;
          telegram_group_announcement_chat_id: string | null;
          telegram_group_announcement_error: string | null;
          telegram_group_announcement_message_id: string | null;
          telegram_group_announcement_status: string;
          terminal_conversation_id: string | null;
          terminal_message_id: string | null;
          token_address: string | null;
          token_logo_storage_path: string | null;
          token_metadata_hash: string | null;
          token_metadata_storage_path: string | null;
          total_msg_value_wei: string | null;
          tweet_id: string | null;
          tx_hash: string | null;
          tx_signature: string | null;
          user_id: string | null;
          work_item_id: string | null;
          worker_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "coin_launches";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_ready_scheduled_actions: {
        Args: { p_limit?: number; p_stale_before?: string; p_worker_id: string };
        Returns: {
          action_payload: Json;
          action_type: string;
          amount_all: boolean;
          amount_eth: number | null;
          amount_original: number | null;
          amount_original_unit: string | null;
          amount_pct: number | null;
          amount_sol: number | null;
          amount_usd: number | null;
          attempt_count: number;
          cancelled_at: string | null;
          chain: string;
          check_count: number;
          created_at: string;
          error: string | null;
          executed_at: string | null;
          execution_result: Json;
          failed_at: string | null;
          id: string;
          idempotency_key: string | null;
          last_checked_at: string | null;
          last_observed_value_usd: number | null;
          max_attempts: number;
          next_check_at: string | null;
          pending_action_id: string | null;
          processed_at: string | null;
          processing_started_at: string | null;
          recipient: string | null;
          scheduled_for: string | null;
          slippage_bps: number | null;
          source: string;
          source_surface: string;
          source_tweet_id: string | null;
          source_tweet_url: string | null;
          status: string;
          token_address: string | null;
          token_symbol: string | null;
          transaction_hash: string | null;
          transaction_id: string | null;
          transaction_signature: string | null;
          trigger_direction: string | null;
          trigger_metric: string | null;
          trigger_payload: Json;
          trigger_type: string;
          trigger_value_usd: number | null;
          updated_at: string;
          user_id: string;
          worker_id: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "scheduled_actions";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_solana_first_launch_funding_v1: {
        Args: {
          p_amount_lamports: string;
          p_destination_address: string;
          p_launch_id: string;
          p_source_address: string;
          p_user_id: string;
          p_wallet_id: string;
        };
        Returns: Json;
      };
      claim_user_transfer_request_v1: {
        Args: {
          p_amount_text: string;
          p_asset: string;
          p_chain: string;
          p_explicit: boolean;
          p_guard_key: string;
          p_recipient: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      claim_x_bot_token_refresh_lock: {
        Args: { p_account_key: string; p_lock_until: string; p_owner: string };
        Returns: {
          access_token_auth_tag: string;
          access_token_ciphertext: string;
          access_token_iv: string;
          account_key: string;
          bot_handle: string;
          created_at: string;
          expires_at: string;
          id: string;
          is_active: boolean;
          last_error: string | null;
          last_refresh_attempt_at: string | null;
          last_refresh_status: string | null;
          last_refreshed_at: string | null;
          refresh_lock_owner: string | null;
          refresh_lock_until: string | null;
          refresh_token_auth_tag: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          scope: string;
          token_type: string;
          updated_at: string;
          x_user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "x_bot_tokens";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      clear_stale_linkr_dispatches_v1: {
        Args: { p_age_seconds?: number };
        Returns: Json;
      };
      compact_terminal_linkr_work_items: {
        Args: {
          p_older_than?: string;
          p_row_budget?: number;
          p_tombstone_retention?: string;
        };
        Returns: Json;
      };
      complete_linkr_stage_batch: {
        Args: {
          p_completions: Json;
          p_queue_name: string;
          p_slot_fencing_token: number;
          p_slot_number: number;
          p_worker_id: string;
        };
        Returns: Json;
      };
      complete_linkr_stage_work: {
        Args: {
          p_expected_state_version: number;
          p_message_id: number;
          p_new_state: string;
          p_next_route?: string;
          p_queue_name: string;
          p_resource_fencing_token: number;
          p_result_ref?: string;
          p_slot_fencing_token: number;
          p_slot_number: number;
          p_work_item_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      confirm_linkr_launch_action_v1: {
        Args: {
          p_chain: string;
          p_confirmation_work_item_id: string;
          p_pending_action_id: string;
          p_wallet_id: string;
        };
        Returns: Json;
      };
      confirm_linkr_launch_action_v2: {
        Args: {
          p_confirmation_work_item_id: string;
          p_pending_action_id: string;
        };
        Returns: Json;
      };
      confirm_solana_first_launch_funding_v1: {
        Args: {
          p_event_id: string;
          p_raw_result?: Json;
          p_slot?: number;
          p_tx_hash: string;
        };
        Returns: {
          amount_wei: string;
          broadcast_attempt_count: number;
          chain: string | null;
          coin_launch_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          destination_address: string;
          error: string | null;
          funding_kind: string;
          id: string;
          last_broadcast_at: string | null;
          last_valid_block_height: number | null;
          raw_result: Json;
          recent_blockhash: string | null;
          signed_transaction_base64: string | null;
          signed_transaction_hash: string | null;
          source_address: string | null;
          status: string;
          tx_hash: string | null;
          updated_at: string;
          user_id: string | null;
          wallet_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "wallet_funding_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      consume_linkr_rate_limit: {
        Args: {
          p_limit: number;
          p_subject_id: string;
          p_subject_type: string;
          p_window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          reset_at: string;
        }[];
      };
      create_linkr_launch_confirmation_v1: {
        Args: { p_action_payload: Json; p_draft_id: string; p_summary: string };
        Returns: Json;
      };
      dead_letter_linkr_stage_work: {
        Args: {
          p_error_fingerprint?: string;
          p_expected_state_version: number;
          p_message_id: number;
          p_queue_name: string;
          p_reason_code: string;
          p_resource_fencing_token: number;
          p_slot_fencing_token: number;
          p_slot_number: number;
          p_work_item_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      dispatch_ready_linkr_workers: {
        Args: { p_global_limit?: number };
        Returns: Json;
      };
      enqueue_linkr_nft_solana_v1: {
        Args: {
          p_parent_work_item_id: string;
          p_payload: Json;
          p_priority?: number;
        };
        Returns: Json;
      };
      enqueue_linkr_x_reply_v1: {
        Args: {
          p_kind: string;
          p_parent_work_item_id: string;
          p_priority?: number;
          p_reply_text: string;
          p_version?: number;
        };
        Returns: Json;
      };
      ensure_linkr_coin_launch_v1: {
        Args: {
          p_image_content_type: string;
          p_image_height: number;
          p_image_sha256: string;
          p_image_url: string;
          p_image_width: number;
          p_original_image_url: string;
          p_pending_action_id: string;
          p_storage_path: string;
          p_work_item_id: string;
        };
        Returns: Json;
      };
      fail_solana_first_launch_funding_v1: {
        Args: { p_error: string; p_event_id: string; p_tx_hash: string };
        Returns: {
          amount_wei: string;
          broadcast_attempt_count: number;
          chain: string | null;
          coin_launch_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          destination_address: string;
          error: string | null;
          funding_kind: string;
          id: string;
          last_broadcast_at: string | null;
          last_valid_block_height: number | null;
          raw_result: Json;
          recent_blockhash: string | null;
          signed_transaction_base64: string | null;
          signed_transaction_hash: string | null;
          source_address: string | null;
          status: string;
          tx_hash: string | null;
          updated_at: string;
          user_id: string | null;
          wallet_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "wallet_funding_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      fail_stale_processing_tweets: {
        Args: { p_cutoff: string; p_limit?: number; p_max_attempts?: number };
        Returns: {
          tweet_id: string;
        }[];
      };
      finalize_linkr_coin_launch_v1: {
        Args: {
          p_chain: string;
          p_details?: Json;
          p_explorer_url: string;
          p_launch_id: string;
          p_reply_text: string;
          p_token_address: string;
          p_transaction_hash: string;
          p_transaction_id: string;
          p_work_item_id: string;
        };
        Returns: Json;
      };
      finalize_linkr_coin_launch_v2: {
        Args: {
          p_chain: string;
          p_details?: Json;
          p_explorer_url: string;
          p_launch_id: string;
          p_reply_text: string;
          p_token_address: string;
          p_transaction_hash: string;
          p_transaction_id: string;
          p_work_item_id: string;
        };
        Returns: Json;
      };
      get_home_system_status: { Args: never; Returns: Json };
      get_home_top_traders_30d: {
        Args: { limit_count?: number };
        Returns: {
          actions: number;
          amount_eth: number;
          avatar_url: string;
          handle: string;
          launches: number;
          posts: number;
          rank: number;
          score: number;
          trades: number;
          volume_usd: number;
        }[];
      };
      get_home_top_wallets_30d: {
        Args: { limit_count?: number };
        Returns: {
          amount_eth: number;
          rank: number;
          trades: number;
          volume_usd: number;
          wallet: string;
        }[];
      };
      get_linkr_admin_platform_health: { Args: never; Returns: Json };
      get_linkr_route_readiness_v1: { Args: never; Returns: Json };
      get_linkr_work_item_status: {
        Args: { p_work_item_id: string };
        Returns: {
          accepted_at: string;
          last_error_code: string;
          request_id: string;
          request_type: string;
          result_ref: string;
          started_at: string;
          state: string;
          terminal_at: string;
        }[];
      };
      get_my_wallet_public_key: { Args: never; Returns: string };
      get_my_wallets: {
        Args: never;
        Returns: {
          address: string;
          chain_id: number;
          created_at: string;
          explorer_url: string;
          id: string;
          is_primary: boolean;
          public_key: string;
          wallet_type: string;
        }[];
      };
      get_public_profiles: {
        Args: { _user_ids: string[] };
        Returns: {
          twitter_name: string;
          twitter_profile_image_url: string;
          twitter_username: string;
          user_id: string;
        }[];
      };
      get_user_profile_stats: { Args: { p_user_id: string }; Returns: Json };
      increment_linkr_terminal_message_count: {
        Args: {
          p_conversation_id: string;
          p_delta: number;
          p_preview?: string;
          p_role?: string;
          p_user_id: string;
        };
        Returns: number;
      };
      infer_agent_run_chain: {
        Args: {
          p_chain: string;
          p_extraction: Json;
          p_thread_context: Json;
          p_tweet_id: string;
        };
        Returns: string;
      };
      invoke_linkr_edge_worker: {
        Args: {
          p_body?: Json;
          p_function_name: string;
          p_health_source: string;
        };
        Returns: number;
      };
      linkr_chain_rollout_allowed_v1: {
        Args: { p_stage: string; p_work_item_id: string };
        Returns: boolean;
      };
      linkr_enqueue_work_item: {
        Args: { p_delay_seconds?: number; p_work_item_id: string };
        Returns: number;
      };
      linkr_fast_dispatch_sweep_v1: {
        Args: { p_limit?: number; p_min_interval_ms?: number };
        Returns: Json;
      };
      linkr_queue_for_route:
        | { Args: { p_priority: number; p_route: string }; Returns: string }
        | { Args: { p_priority?: number; p_route: string }; Returns: string };
      linkr_queue_message_exists: {
        Args: { p_message_id: number; p_queue_name: string };
        Returns: boolean;
      };
      linkr_reconcile_resource_heads_v1: {
        Args: { p_max_batch?: number };
        Returns: number;
      };
      linkr_reconcile_resource_heads_v2: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      linkr_watchdog_reap_stalled_v1: {
        Args: { p_max_batch?: number; p_timeout_seconds?: number };
        Returns: number;
      };
      lookup_linkr_auth_user_by_email: {
        Args: { p_email: string };
        Returns: string;
      };
      mark_linkr_dispatch_finished: {
        Args: {
          p_backlog_remains?: boolean;
          p_stage: string;
          p_wake_generation: number;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      mark_linkr_dispatch_started: {
        Args: {
          p_lease_seconds: number;
          p_stage: string;
          p_wake_generation: number;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      normalize_action_source_surface: {
        Args: { p_fallback?: string; p_source: string };
        Returns: string;
      };
      pause_linkr_launch_for_funds_v1: {
        Args: {
          p_launch_id: string;
          p_reason_code: string;
          p_work_item_id: string;
        };
        Returns: Json;
      };
      pause_linkr_launch_preparation_v1: {
        Args: { p_draft_id: string; p_reason_code: string };
        Returns: Json;
      };
      persist_linkr_signed_transaction: {
        Args: {
          p_attempt_number: number;
          p_blockhash?: string;
          p_chain: string;
          p_encrypted_key_material_base64?: string;
          p_expected_state_version: number;
          p_gas_policy?: Json;
          p_last_valid_block_height?: number;
          p_launch_id: string;
          p_nonce?: number;
          p_payload_hash?: string;
          p_predicted_address?: string;
          p_resource_fencing_token: number;
          p_signature?: string;
          p_signed_transaction_base64: string;
          p_signed_transaction_hash: string;
          p_slot_fencing_token: number;
          p_slot_number: number;
          p_stage: string;
          p_transaction_hash?: string;
          p_wallet_id: string;
          p_work_item_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      prepare_solana_first_launch_funding_v1: {
        Args: {
          p_event_id: string;
          p_last_valid_block_height: number;
          p_launch_id: string;
          p_raw_result?: Json;
          p_recent_blockhash: string;
          p_signed_transaction_base64: string;
          p_signed_transaction_hash: string;
          p_tx_hash: string;
          p_user_id: string;
        };
        Returns: {
          amount_wei: string;
          broadcast_attempt_count: number;
          chain: string | null;
          coin_launch_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          destination_address: string;
          error: string | null;
          funding_kind: string;
          id: string;
          last_broadcast_at: string | null;
          last_valid_block_height: number | null;
          raw_result: Json;
          recent_blockhash: string | null;
          signed_transaction_base64: string | null;
          signed_transaction_hash: string | null;
          source_address: string | null;
          status: string;
          tx_hash: string | null;
          updated_at: string;
          user_id: string | null;
          wallet_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "wallet_funding_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      prune_agent_api_nonces: { Args: { p_before?: string }; Returns: number };
      prune_linkr_queue_operational_data: {
        Args: { p_row_budget?: number };
        Returns: Json;
      };
      prune_operational_logs:
        | {
            Args: {
              p_cron_retention_days?: number;
              p_health_retention_days?: number;
              p_market_event_retention_days?: number;
              p_market_snapshot_retention_days?: number;
              p_net_response_retention_hours?: number;
              p_token_event_retention_days?: number;
            };
            Returns: Json;
          }
        | {
            Args: {
              p_batch_size?: number;
              p_cron_retention_days?: number;
              p_health_retention_days?: number;
              p_market_event_retention_days?: number;
              p_market_snapshot_retention_days?: number;
              p_max_rows_per_table?: number;
              p_net_response_retention_hours?: number;
              p_token_event_retention_days?: number;
            };
            Returns: Json;
          };
      queue_linkr_launch_enrichment_v1: {
        Args: { p_draft_id: string; p_input_work_item_id: string };
        Returns: Json;
      };
      queue_linkr_stage_delay_notices_v1: {
        Args: {
          p_consumer_version: string;
          p_error_code: string;
          p_limit?: number;
          p_stage: string;
        };
        Returns: number;
      };
      record_linkr_dispatch_result_v1: {
        Args: {
          p_error_message?: string;
          p_request_id: number;
          p_stage: string;
          p_status_code: number;
          p_timed_out?: boolean;
        };
        Returns: Json;
      };
      record_linkr_platform_incident_v1: {
        Args: {
          p_details?: Json;
          p_fingerprint: string;
          p_severity: string;
          p_title: string;
        };
        Returns: string;
      };
      record_solana_first_launch_funding_broadcast_v1: {
        Args: { p_event_id: string; p_tx_hash: string };
        Returns: {
          amount_wei: string;
          broadcast_attempt_count: number;
          chain: string | null;
          coin_launch_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          destination_address: string;
          error: string | null;
          funding_kind: string;
          id: string;
          last_broadcast_at: string | null;
          last_valid_block_height: number | null;
          raw_result: Json;
          recent_blockhash: string | null;
          signed_transaction_base64: string | null;
          signed_transaction_hash: string | null;
          source_address: string | null;
          status: string;
          tx_hash: string | null;
          updated_at: string;
          user_id: string | null;
          wallet_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "wallet_funding_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_system_health_event: {
        Args: {
          p_details?: Json;
          p_latency_ms: number;
          p_sample_minutes?: number;
          p_source: string;
          p_status: string;
        };
        Returns: undefined;
      };
      recover_stale_processing_tweets: {
        Args: { p_cutoff: string; p_limit?: number; p_max_attempts?: number };
        Returns: {
          tweet_id: string;
        }[];
      };
      recover_stranded_linkr_work_item: {
        Args: { p_work_item_id: string };
        Returns: Json;
      };
      redrive_linkr_explicit_launch_v1: {
        Args: { p_chain: string; p_tweet_id: string };
        Returns: Json;
      };
      refresh_coin_launch_reward_recipients: {
        Args: { p_launch_id: string };
        Returns: number;
      };
      reject_linkr_launch_request_v1: {
        Args: {
          p_reason_code: string;
          p_user_message: string;
          p_work_item_id: string;
        };
        Returns: Json;
      };
      release_cron_lock: {
        Args: { p_lock_name: string; p_owner: string };
        Returns: boolean;
      };
      release_expired_linkr_leases: { Args: never; Returns: Json };
      release_x_bot_token_refresh_lock: {
        Args: { p_owner: string; p_token_id: string };
        Returns: undefined;
      };
      repair_linkr_request_pipeline_v1: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      request_linkr_stage_wake: { Args: { p_stage: string }; Returns: Json };
      reset_user_launch_state: { Args: { p_user_id: string }; Returns: Json };
      resolve_linkr_launch_thread_v1: {
        Args: { p_input_work_item_id: string; p_user_id: string };
        Returns: Json;
      };
      resume_linkr_launch_after_funding_v1: {
        Args: { p_input_work_item_id: string; p_user_id: string };
        Returns: Json;
      };
      retry_linkr_stage_work: {
        Args: {
          p_delay_seconds: number;
          p_error_code: string;
          p_expected_state_version: number;
          p_message_id: number;
          p_queue_name: string;
          p_resource_fencing_token: number;
          p_slot_fencing_token: number;
          p_slot_number: number;
          p_work_item_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      run_linkr_queue_controller_tick: { Args: never; Returns: Json };
      run_linkr_x_pipeline_tick: { Args: never; Returns: Json };
      sample_linkr_platform_active: { Args: never; Returns: Json };
      sample_linkr_platform_capacity_deep: { Args: never; Returns: Json };
      search_linkr_user_memory: {
        Args: { p_limit?: number; p_query: string; p_user_id: string };
        Returns: {
          created_at: string;
          metadata: Json;
          rank: number;
          searchable_text: string;
          source_id: string;
          source_type: string;
          title: string;
        }[];
      };
      set_my_primary_wallet: {
        Args: { p_wallet_id: string };
        Returns: {
          address: string;
          chain_id: number;
          created_at: string;
          explorer_url: string;
          id: string;
          is_primary: boolean;
          public_key: string;
          wallet_type: string;
        }[];
      };
      settle_user_transfer_request_v1: {
        Args: {
          p_request_id: string;
          p_response?: Json;
          p_status: string;
          p_tx_hash?: string;
        };
        Returns: undefined;
      };
      transition_linkr_chain_transaction: {
        Args: {
          p_error_code?: string;
          p_expected_state_version: number;
          p_expected_transaction_state: string;
          p_new_transaction_state: string;
          p_resource_fencing_token: number;
          p_slot_fencing_token: number;
          p_slot_number: number;
          p_stage: string;
          p_transaction_hash?: string;
          p_transaction_id: string;
          p_work_item_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      update_linkr_launch_enrichment_v1: {
        Args: {
          p_draft_id: string;
          p_expected_version: number;
          p_generated_fields: Json;
          p_generated_provenance: Json;
          p_generation_context: Json;
        };
        Returns: Json;
      };
      upsert_linkr_launch_draft_v1: {
        Args: {
          p_filled_fields: Json;
          p_input_work_item_id: string;
          p_required_fields: string[];
          p_source_tweet_id: string;
          p_surface_conversation_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      upsert_linkr_launch_draft_v2: {
        Args: {
          p_field_provenance: Json;
          p_filled_fields: Json;
          p_generation_context?: Json;
          p_input_work_item_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
