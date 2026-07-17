run "canonicalizes_public_and_issuer_origins" {
  command = plan

  variables {
    public_url                   = "https://storage.example/"
    takosumi_accounts_issuer_url = "https://accounts.example/"
  }

  assert {
    condition     = output.launch_url == "https://storage.example"
    error_message = "launch_url must be the canonical public origin."
  }

  assert {
    condition     = output.api_url == "https://storage.example/o"
    error_message = "api_url must match the APP_URL-derived object audience."
  }

  assert {
    condition     = output.mcp_url == "https://storage.example/mcp"
    error_message = "mcp_url must match the APP_URL-derived MCP audience."
  }
}

run "rejects_public_url_path" {
  command = plan

  variables {
    public_url = "https://storage.example/nested"
  }

  expect_failures = [var.public_url]
}

run "rejects_public_url_query" {
  command = plan

  variables {
    public_url = "https://storage.example/?tenant=a"
  }

  expect_failures = [var.public_url]
}

run "rejects_issuer_path" {
  command = plan

  variables {
    takosumi_accounts_issuer_url = "https://accounts.example/issuer"
  }

  expect_failures = [var.takosumi_accounts_issuer_url]
}

run "rejects_issuer_userinfo" {
  command = plan

  variables {
    takosumi_accounts_issuer_url = "https://user@accounts.example"
  }

  expect_failures = [var.takosumi_accounts_issuer_url]
}
