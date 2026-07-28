import { AlertTriangle } from "lucide-react";

export function PoolsRiskWarning() {
  return (
    <div className="app-pools-risk">
      <AlertTriangle aria-hidden="true" className="h-4 w-4 text-warning" />
      <div>
        <strong>Liquidity provider risks</strong>
        <p>
          Impermanent loss: your position value may decrease compared with simply holding the
          tokens.
        </p>
        <p>Smart contract risk: DeFi protocols can contain bugs or unexpected behavior.</p>
        <p>
          Token risk: providing liquidity to low-quality or thinly traded tokens can result in
          losses.
        </p>
        <p>Only provide liquidity you can afford to lose.</p>
      </div>
    </div>
  );
}
