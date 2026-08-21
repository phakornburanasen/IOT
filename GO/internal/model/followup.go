package model

type FollowUpWorkItem struct {
	UID       string  `json:"uid"`
	Team      *string `json:"team"`
	BoxNo     *string `json:"box_no"`
	Start     *string `json:"start"`
	LatestAt  *string `json:"latest_status_at"`
	Status    *string `json:"status"`
	EmpID     *string `json:"emp_id"`
	User      string  `json:"user"`
	UserName  *string `json:"user_name"`
	KeyButton *int64  `json:"key_button"`
	FinishAt  *string `json:"finish_at"`
}

type FollowUpWorkListResult struct {
	Data       []FollowUpWorkItem `json:"data"`
	Total      int64              `json:"total"`
	Page       int                `json:"page"`
	Limit      int                `json:"limit"`
	TotalPages int64              `json:"total_pages"`
}

type FollowUpBundleDetail struct {
	RFID      *string `json:"rfid"`
	Barcode   *string `json:"barcode"`
	QTY       *int64  `json:"qty"`
	SAPOrder  *string `json:"saporder"`
	Bundle    *int64  `json:"bundle"`
	Style     *string `json:"style"`
	Color     *string `json:"color"`
	Progress  *string `json:"progress"`
	SourceKey *string `json:"source_key"`
}

type FollowUpDetailResponse struct {
	Summary FollowUpWorkItem     `json:"summary"`
	Detail  FollowUpBundleDetail `json:"detail"`
}
